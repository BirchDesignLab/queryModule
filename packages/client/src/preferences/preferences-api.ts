import type { ApiClient } from "../api/create-api-client.js";
import {
  isPreferenceLayout,
  isThemeModePreference,
  type PreferencesSnapshot,
  type PreferencesStore,
} from "./preferences-store.js";

export async function loadPreferences(api: ApiClient, store: PreferencesStore): Promise<void> {
  const { data } = await api.GET("/api/v1/me/preferences");
  if (data === undefined) return;
  store.getState().hydrate({
    themeMode: isThemeModePreference(data.themeMode) ? data.themeMode : null,
    personaOverride: typeof data.personaOverride === "string" ? data.personaOverride : null,
    layout: isPreferenceLayout(data.layout) ? data.layout : null,
  });
}

/** One client's save queue: the tail, the saves in flight, and the session they belong to. */
interface SaveQueue {
  tail: Promise<unknown>;
  inFlight: Set<AbortController>;
  /** Bumped when the session changes: a save made under an older one never writes. */
  epoch: number;
}

const saveQueues = new WeakMap<ApiClient, SaveQueue>();

function queueOf(api: ApiClient): SaveQueue {
  let queue = saveQueues.get(api);
  if (queue === undefined) {
    queue = { tail: Promise.resolve(), inFlight: new Set(), epoch: 0 };
    saveQueues.set(api, queue);
  }
  return queue;
}

/**
 * PUT replaces the row, so the patch is merged into the current server copy first. Saves from one
 * client run one after another, so a theme save and a layout save that overlap each read the row
 * the other wrote (not the stale copy that would drop its change). A save that a session change
 * (resetPreferenceSaves) cuts off settles false.
 */
export function savePreferences(
  api: ApiClient,
  patch: Partial<PreferencesSnapshot>,
): Promise<boolean> {
  const queue = queueOf(api);
  const epoch = queue.epoch;
  const turn = queue.tail.then(async () => {
    if (queue.epoch !== epoch) return false;
    try {
      return await putMerged(api, patch, queue);
    } catch (error) {
      if (queue.epoch !== epoch) return false;
      throw error;
    }
  });
  // A failed save must not hold up the next one; its caller still sees the rejection.
  queue.tail = turn.catch(() => undefined);
  return turn;
}

/**
 * Sign-out, a 401 or another user (spec 6.7): saves still queued are dropped and the one in flight
 * is aborted, so one user's preference is never written into the next session's row.
 */
export function resetPreferenceSaves(api: ApiClient): void {
  const queue = queueOf(api);
  queue.epoch += 1;
  for (const controller of queue.inFlight) controller.abort(new Error("session ended"));
  queue.inFlight.clear();
}

/** A save that gets no answer in this long is given up, so it cannot hold the queue for good. */
const SAVE_TIMEOUT_MS = 10_000;

async function putMerged(
  api: ApiClient,
  patch: Partial<PreferencesSnapshot>,
  queue: SaveQueue,
): Promise<boolean> {
  const controller = new AbortController();
  queue.inFlight.add(controller);
  const timer = setTimeout(
    () => controller.abort(new Error("preferences save timed out")),
    SAVE_TIMEOUT_MS,
  );
  try {
    return await putMergedWith(api, patch, controller.signal);
  } finally {
    clearTimeout(timer);
    queue.inFlight.delete(controller);
  }
}

async function putMergedWith(
  api: ApiClient,
  patch: Partial<PreferencesSnapshot>,
  signal: AbortSignal,
): Promise<boolean> {
  const current = await api.GET("/api/v1/me/preferences", { signal });
  if (current.data === undefined) return false;
  const { response } = await api.PUT("/api/v1/me/preferences", {
    body: { ...current.data, ...patch },
    signal,
  });
  return response.ok;
}
