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

/** The tail of each client's save queue: a save starts when the one before it has settled. */
const saveQueues = new WeakMap<ApiClient, Promise<unknown>>();

/**
 * PUT replaces the row, so the patch is merged into the current server copy first. Saves from one
 * client run one after another, so a theme save and a layout save that overlap each read the row
 * the other wrote (not the stale copy that would drop its change).
 */
export function savePreferences(
  api: ApiClient,
  patch: Partial<PreferencesSnapshot>,
): Promise<boolean> {
  const turn = (saveQueues.get(api) ?? Promise.resolve()).then(() => putMerged(api, patch));
  // A failed save must not hold up the next one; its caller still sees the rejection.
  saveQueues.set(
    api,
    turn.catch(() => undefined),
  );
  return turn;
}

async function putMerged(api: ApiClient, patch: Partial<PreferencesSnapshot>): Promise<boolean> {
  const current = await api.GET("/api/v1/me/preferences");
  if (current.data === undefined) return false;
  const { response } = await api.PUT("/api/v1/me/preferences", {
    body: { ...current.data, ...patch },
  });
  return response.ok;
}
