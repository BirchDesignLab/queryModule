import type { ApiClient } from "../api/create-api-client.js";
import type { SourceStatusEvent, Timers } from "../feed/feed-socket.js";
import type { RequestsStore } from "./requests.js";

export interface ResultFetcherOptions {
  api: ApiClient;
  timers: Timers;
  store: RequestsStore;
  /** In [0, 1); the retry jitter, as the feed draws it. Defaults to Math.random. */
  random?: () => number;
}

export interface ResultFetcher {
  /** Call after the store has applied the event; schedules the detail fetch for its request. */
  handleEvent(event: SourceStatusEvent): void;
  /** On logout, a 401 or a change of user (spec 6.7): cancels every fetch and timer, drops state. */
  reset(): void;
}

/** Events for one request inside this window share one fetch. */
const WINDOW_MS = 200;
/** The feed's reconnect backoff (feed-socket.ts): full jitter, doubling, capped. */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

interface Slot {
  /** The open coalescing timer, if one is open. */
  window: unknown;
  /** The wait before a retry after a failed fetch. */
  retry: unknown;
  controller: AbortController | null;
  /** An event arrived while a fetch was in flight: one more fetch follows. */
  trailing: boolean;
  attempts: number;
}

/**
 * Fetches `GET /api/v1/queries/:correlationId` when sources settle and folds the detail into the
 * requests store (FR-043, FR-044, FR-065; spec 5.2 step 7, 6.7, 6.8). One fetch in flight per
 * correlation ID, one trailing. The fetch is marked `X-Background: 1` so it does not count as user
 * activity (Q3). Payloads are regulated client data: they go to the store and nowhere else, and
 * nothing here logs, stores or builds a URL from them. A 404 drops quietly; a network failure
 * retries on the feed's backoff while a source is still pending.
 */
export function createResultFetcher(options: ResultFetcherOptions): ResultFetcher {
  const { api, timers, store } = options;
  const random = options.random ?? Math.random;
  const slots = new Map<string, Slot>();
  /** Correlation IDs already scheduled once from the store's own state, so a fetch cannot loop. */
  const known = new Set<string>();
  /** Bumped by `reset`; a response from an earlier generation is ignored. */
  let generation = 0;

  const slotOf = (correlationId: string): Slot => {
    let slot = slots.get(correlationId);
    if (slot === undefined) {
      slot = { window: null, retry: null, controller: null, trailing: false, attempts: 0 };
      slots.set(correlationId, slot);
    }
    return slot;
  };

  const hasPending = (correlationId: string): boolean => {
    const entry = store
      .getState()
      .items.find((item) => item.status === "acknowledged" && item.correlationId === correlationId);
    // Not listed yet: the placeholder is still to be built, so the fetch is still wanted.
    if (entry?.status !== "acknowledged") return true;
    return entry.parts.some((part) => part.sources.some((source) => source.status === "pending"));
  };

  const run = async (correlationId: string): Promise<void> => {
    const slot = slotOf(correlationId);
    const mine = generation;
    const controller = new AbortController();
    slot.controller = controller;
    let failed = false;
    try {
      const { data, response } = await api.GET("/api/v1/queries/{correlationId}", {
        params: { path: { correlationId } },
        headers: { "X-Background": "1" },
        signal: controller.signal,
      });
      if (mine !== generation) return;
      if (data !== undefined) {
        slot.attempts = 0;
        store.getState().applyDetail(data);
      } else if (response.status >= 500) {
        failed = true;
      }
      // Any other answer (404, 403, 400) drops the fetch quietly: nothing to say, nothing to keep.
    } catch {
      if (mine !== generation) return;
      failed = true;
    }
    slot.controller = null;
    if (failed && hasPending(correlationId)) {
      const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** slot.attempts);
      slot.attempts += 1;
      slot.retry = timers.setTimeout(
        () => {
          slot.retry = null;
          void run(correlationId);
        },
        Math.floor(random() * ceiling),
      );
      return;
    }
    if (slot.trailing) {
      slot.trailing = false;
      schedule(correlationId);
    }
  };

  function schedule(correlationId: string): void {
    known.add(correlationId);
    const slot = slotOf(correlationId);
    if (slot.window !== null || slot.retry !== null) return;
    if (slot.controller !== null) {
      slot.trailing = true;
      return;
    }
    slot.window = timers.setTimeout(() => {
      slot.window = null;
      void run(correlationId);
    }, WINDOW_MS);
  }

  // A request whose events outran its 202 is fetched once the 202 lands (spec 6.7).
  store.subscribe((state) => {
    for (const item of state.items) {
      if (item.status !== "acknowledged" || known.has(item.correlationId)) continue;
      if (item.parts.some((part) => part.sources.some((s) => s.status === "returned"))) {
        schedule(item.correlationId);
      }
    }
  });

  return {
    handleEvent(event) {
      if (event.status === "pending") return;
      schedule(event.correlationId);
    },
    reset() {
      generation += 1;
      for (const slot of slots.values()) {
        if (slot.window !== null) timers.clearTimeout(slot.window);
        if (slot.retry !== null) timers.clearTimeout(slot.retry);
        slot.controller?.abort();
      }
      slots.clear();
      known.clear();
    },
  };
}
