import type { ApiClient } from "../api/create-api-client.js";
import type { SourceStatusEvent, Timers } from "../feed/feed-socket.js";
import type { RequestEntry, RequestsStore } from "./requests.js";

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
  /**
   * Loads `GET /api/v1/queries?limit=50` and folds it into the store (spec 6.7, 6.8): on sign-in and
   * after a `resync`. The list has no payloads, so each returned source it shows is fetched through
   * the detail fetch. Calls made while one is in flight share it, with one trailing call; a network
   * failure retries on the feed's backoff. Resolves when the load has been merged or has given up.
   */
  loadList(): Promise<void>;
  /**
   * After a reconnect, or at a backoff step while the socket is down (spec 6.8): schedules the detail
   * fetch of every entry that still has a pending source, or a returned one without its payload.
   */
  refetchPending(): void;
  /** On logout, a 401 or a change of user (spec 6.7): cancels every fetch and timer, drops state. */
  reset(): void;
}

/** Events for one request inside this window share one fetch. */
const WINDOW_MS = 200;
/** Detail fetches in flight at once; the rest wait, the entries nearest the top of the list first. */
const MAX_IN_FLIGHT = 4;
/** The list load asks for this many requests and merges no more (spec 6.8). */
const LIST_LIMIT = 50;
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
 * retries on the feed's backoff while a source is pending or a returned one lacks its payload.
 */
export function createResultFetcher(options: ResultFetcherOptions): ResultFetcher {
  const { api, timers, store } = options;
  const random = options.random ?? Math.random;
  const slots = new Map<string, Slot>();
  /** Correlation IDs already scheduled once from the store's own state, so a fetch cannot loop. */
  const known = new Set<string>();
  /** Bumped by `reset`; a response from an earlier generation is ignored. */
  let generation = 0;
  /** Correlation IDs whose window closed and which wait for one of the {@link MAX_IN_FLIGHT} slots. */
  const queue = new Set<string>();
  let inFlight = 0;
  // The list load: one in flight, one trailing, one retry timer.
  let listLoad: Promise<void> | null = null;
  let listTrailing = false;
  let listRetry: unknown = null;
  let listAttempts = 0;
  let listController: AbortController | null = null;

  const slotOf = (correlationId: string): Slot => {
    let slot = slots.get(correlationId);
    if (slot === undefined) {
      slot = { window: null, retry: null, controller: null, trailing: false, attempts: 0 };
      slots.set(correlationId, slot);
    }
    return slot;
  };

  /** A returned source has no payload yet (spec 6.7: the fetch is owed). */
  const lacksPayload = (entry: Extract<RequestEntry, { status: "acknowledged" }>): boolean =>
    entry.parts.some((part) =>
      part.sources.some((source) => source.status === "returned" && source.result === undefined),
    );

  /** A source is pending, or a returned source has no payload yet (spec 6.7: the fetch is owed). */
  const owesFetch = (entry: Extract<RequestEntry, { status: "acknowledged" }>): boolean =>
    lacksPayload(entry) ||
    entry.parts.some((part) => part.sources.some((source) => source.status === "pending"));

  const needsFetch = (correlationId: string): boolean => {
    const entry = store
      .getState()
      .items.find((item) => item.status === "acknowledged" && item.correlationId === correlationId);
    // Not listed yet: the placeholder is still to be built, so the fetch is still wanted.
    if (entry?.status !== "acknowledged") return true;
    return owesFetch(entry);
  };

  /** The queued entry nearest the top of the list (the list shows newest first); the oldest queued if none shows. */
  const nextQueued = (): string | undefined => {
    for (const item of store.getState().items) {
      if (item.status === "acknowledged" && queue.has(item.correlationId)) {
        return item.correlationId;
      }
    }
    return queue.values().next().value;
  };

  /** Starts queued fetches while a slot is free. */
  const pump = (): void => {
    while (inFlight < MAX_IN_FLIGHT) {
      const next = nextQueued();
      if (next === undefined) return;
      queue.delete(next);
      void run(next);
    }
  };

  const enqueue = (correlationId: string): void => {
    queue.add(correlationId);
    pump();
  };

  /** Holds one slot for the length of the fetch; a reset has already emptied the slots. */
  const run = async (correlationId: string): Promise<void> => {
    const mine = generation;
    inFlight += 1;
    try {
      await attempt(correlationId, mine);
    } finally {
      if (mine === generation) {
        inFlight -= 1;
        pump();
      }
    }
  };

  const attempt = async (correlationId: string, mine: number): Promise<void> => {
    const slot = slotOf(correlationId);
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
    if (failed && needsFetch(correlationId)) {
      const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** slot.attempts);
      slot.attempts += 1;
      slot.retry = timers.setTimeout(
        () => {
          slot.retry = null;
          enqueue(correlationId);
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
    // Waiting for a slot: the fetch has not started, so it will see whatever this event brought.
    if (slot.window !== null || slot.retry !== null || queue.has(correlationId)) return;
    if (slot.controller !== null) {
      slot.trailing = true;
      return;
    }
    slot.window = timers.setTimeout(() => {
      slot.window = null;
      enqueue(correlationId);
    }, WINDOW_MS);
  }

  /** Schedules the fetch of every entry that has a returned source without its payload. */
  const scheduleOwed = (): void => {
    for (const item of store.getState().items) {
      if (item.status === "acknowledged" && lacksPayload(item)) schedule(item.correlationId);
    }
  };

  /** One call of the list; a network failure or a 5xx schedules the retry on the feed's backoff. */
  const listOnce = async (mine: number): Promise<void> => {
    const controller = new AbortController();
    listController = controller;
    let failed = false;
    try {
      const { data, response } = await api.GET("/api/v1/queries", {
        params: { query: { limit: LIST_LIMIT } },
        headers: { "X-Background": "1" },
        signal: controller.signal,
      });
      if (mine !== generation) return;
      if (data !== undefined) {
        listAttempts = 0;
        store.getState().applyList(data.requests.slice(0, LIST_LIMIT));
        scheduleOwed();
      } else if (response.status >= 500) {
        failed = true;
      }
      // Any other answer (400, 403) drops the load quietly: nothing to say, nothing to keep.
    } catch {
      if (mine !== generation) return;
      failed = true;
    }
    listController = null;
    if (!failed) return;
    // The retry stands in for any trailing call: asking again at once would not beat the backoff.
    listTrailing = false;
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** listAttempts);
    listAttempts += 1;
    listRetry = timers.setTimeout(
      () => {
        listRetry = null;
        void loadList();
      },
      Math.floor(random() * ceiling),
    );
  };

  const runList = async (): Promise<void> => {
    const mine = generation;
    do {
      listTrailing = false;
      await listOnce(mine);
      if (mine !== generation) return;
    } while (listTrailing);
  };

  function loadList(): Promise<void> {
    if (listLoad !== null) {
      listTrailing = true;
      return listLoad;
    }
    // A call made now stands in for the retry that was waiting.
    if (listRetry !== null) timers.clearTimeout(listRetry);
    listRetry = null;
    const load = runList();
    listLoad = load;
    void load.then(() => {
      if (listLoad === load) listLoad = null;
    });
    return load;
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
    loadList,
    refetchPending() {
      for (const item of store.getState().items) {
        if (item.status === "acknowledged" && owesFetch(item)) schedule(item.correlationId);
      }
    },
    reset() {
      generation += 1;
      inFlight = 0;
      queue.clear();
      listLoad = null;
      listTrailing = false;
      listAttempts = 0;
      if (listRetry !== null) timers.clearTimeout(listRetry);
      listRetry = null;
      listController?.abort();
      listController = null;
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
