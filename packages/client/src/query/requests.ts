import type { SourceStatus } from "@querymodule/core/contracts";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { components } from "../api/generated/openapi-types.js";
import type { SourceStatusEvent, Timers } from "../feed/feed-socket.js";
import type { SubmitOutcome, SubmitQueryResponse, SubmitRequest } from "./submit.js";

/** One request with its parts, per-source status and payloads (GET /api/v1/queries/:correlationId). */
export type QueryDetail = components["schemas"]["getQuery200"];

/** One request of `GET /api/v1/queries`: the detail shape, with no payloads (spec 5.1). */
export type QueryListEntry = components["schemas"]["listQueries200"]["requests"][number];

/** Why a request did not reach an acknowledgment: the submit outcome's kind, translated at render. */
export type RequestFailure = Exclude<SubmitOutcome["kind"], "acknowledged">;

/**
 * What a request sent, kept with its row so a failed one can be sent again: the query type, the
 * field values (the subtype is one of them), the sources and the mode. Memory only, cleared with
 * the row (a reset, the 100-row cap). The config hash is not kept: a retry goes under the current one
 * (the server replays by Idempotency-Key alone, so the new hash does not make it a new request).
 */
export type SubmittedQuery = Omit<SubmitRequest, "configHash">;

interface RequestBase {
  /** A local key, never reused, so a row keeps its identity from Sending to its final state. */
  id: string;
  /** Epoch milliseconds the row began; tells two un-acknowledged rows apart by name (ruling 12). */
  sentAt: number;
  queryType: string;
  /** The command the request was built as; shown in mono. Memory only, cleared with the session. */
  summary: string;
  /** Absent for a row begun without values; such a row cannot be retried. */
  submitted?: SubmittedQuery;
  /**
   * The Idempotency-Key the request went under (SUBMIT-1): a Retry sends it again, so the server
   * answers the original acknowledgment if it already holds the request. Memory only, like the row.
   */
  idempotencyKey?: string;
  /**
   * Set on a failed row once a retry of it was acknowledged (M1 exit C1): the request it stands
   * for is now listed as acknowledged, so it cannot be retried again.
   */
  superseded?: true;
  /**
   * Set on a row built from a fetched detail for a request this list never sent (an event for an
   * unknown correlation ID, spec 6.7). Its own 202, if one is still coming, replaces it.
   */
  placeholder?: true;
}

/**
 * One source a part went to and where it stands. `result` is the source's payload once fetched:
 * regulated client data (spec 6.7), memory only, gone with the row on a reset.
 */
export interface RequestSource {
  sourceId: string;
  status: SourceStatus;
  result?: { payload: Record<string, unknown> };
}

/** A part of the 202 with its sources: every dispatched pair starts pending, a skipped part has none. */
export type RequestPart = SubmitQueryResponse["parts"][number] & {
  sources: readonly RequestSource[];
};

export interface StatusSummary {
  /** Sources past pending. */
  done: number;
  /** Every (part, source) pair the request was dispatched to. */
  total: number;
  /** Only the statuses present. */
  byStatus: Partial<Record<SourceStatus, number>>;
  /** Sources a dispatched part dropped before dispatch (plate-only mode); not part of `total` (#587). */
  notRun: number;
}

/** A source that just gained its payload: ids only, never the payload (spec 6.6, 6.7). */
export interface ResultArrival {
  correlationId: string;
  partId: number;
  sourceId: string;
}

/** What the coalesced announcement is built from: ids and counts, never values (spec 6.6). */
export interface StatusAnnouncement {
  correlationId: string;
  queryType: string;
  summary: StatusSummary;
}

export type RequestEntry = RequestBase &
  (
    | { status: "sending" }
    | {
        status: "acknowledged";
        correlationId: string;
        /** Epoch milliseconds, from the 202. */
        acknowledgedAt: number;
        parts: readonly RequestPart[];
      }
    | { status: "failed"; failure: RequestFailure }
  );

export interface RequestsState {
  /** This session's requests, newest first. */
  items: readonly RequestEntry[];
  /** Adds a Sending row and returns its key. */
  begin(request: {
    queryType: string;
    summary: string;
    submitted?: SubmittedQuery;
    idempotencyKey?: string;
  }): string;
  /**
   * Turns the row into Acknowledged or Failed; a row a reset already cleared is ignored. With
   * `once` (a retry), an acknowledgment whose correlation ID another row already shows (a replayed
   * ack, FR-064) removes this row instead, so the request is listed once. Returns the id of the row
   * that now shows the outcome, or undefined when the row is gone.
   */
  settle(id: string, outcome: SubmitOutcome, options?: { once?: boolean }): string | undefined;
  /** Marks a failed row superseded (its retry was acknowledged); any other row is left as is. */
  supersede(id: string): void;
  /**
   * Applies one `sourceStatus` event (spec 6.7): a source moves from pending to its terminal status
   * once and never back; an event for an unknown pair changes nothing; an event for a request this
   * list has not acknowledged yet is held (bounded) for the 202 to fill. A change is announced
   * through `onStatusSummary`, coalesced per correlation ID (spec 6.6).
   */
  applyEvent(event: SourceStatusEvent): void;
  /**
   * Applies a fetched detail (spec 6.7): a pending source moves to the detail's status (never
   * backwards), each returned source gains its payload, parts take the detail's origin, parent and
   * skip reasons. A correlation ID this list does not hold becomes a placeholder row.
   */
  applyDetail(detail: QueryDetail): void;
  /**
   * Folds the list `GET /api/v1/queries` answered into the rows (spec 6.7, 6.8): a request this list
   * holds moves forward only (a pending source takes the list's status; announced, since it settled
   * while nothing was listening); one it does not hold becomes a placeholder row, placed by time among
   * the rows and never announced (it is history). Rows already shown keep their id and place. The list
   * carries no payloads: they come from the detail fetch.
   */
  applyList(requests: readonly QueryListEntry[]): void;
  /** One call per correlation ID per 1500 ms window that changed something; returns the unsubscribe. */
  onStatusSummary(handler: (announcement: StatusAnnouncement) => void): () => void;
  /**
   * One call, at once and never coalesced, for each source that gains its payload from a fetched
   * detail (a critical result is announced without waiting for the 1500 ms window, spec 6.6).
   * Ids only: the handler reads the payload from the store. Returns the unsubscribe.
   */
  onResult(handler: (arrival: ResultArrival) => void): () => void;
  reset(): void;
}

export type RequestsStore = StoreApi<RequestsState>;

/** Status changes for one request within this window are announced as one summary (spec 6.6). */
const COALESCE_MS = 1500;
/** Events that outran their 202 are held for this many requests; older ones are dropped. */
const MAX_HELD_REQUESTS = 50;
/**
 * Held events per request: one per (part, source) pair, and a request has a handful of parts with
 * a few sources each. Past this a request is not one the 202 will describe; the rest are dropped.
 */
const MAX_HELD_PER_REQUEST = 16;
/** Held events in total, so 50 requests at the per-request cap cannot all sit in memory; oldest request first out. */
const MAX_HELD_EVENTS = 200;

/** Counts of a request's sources by status, over every dispatched part, and how many were not run. */
export function statusSummary(
  entry: Extract<RequestEntry, { status: "acknowledged" }>,
): StatusSummary {
  const byStatus: Partial<Record<SourceStatus, number>> = {};
  let done = 0;
  let total = 0;
  let notRun = 0;
  for (const part of entry.parts) {
    // A skipped part ran nothing; its own line says so, so its sources are not also counted.
    if (part.status === "dispatched") notRun += part.droppedSourceIds.length;
    for (const source of part.sources) {
      total += 1;
      if (source.status !== "pending") done += 1;
      byStatus[source.status] = (byStatus[source.status] ?? 0) + 1;
    }
  }
  return { done, total, byStatus, notRun };
}

const withSources = (parts: SubmitQueryResponse["parts"]): RequestPart[] =>
  parts.map((part) => ({
    ...part,
    sources:
      part.status === "skipped"
        ? []
        : part.sourceIds.map((sourceId) => ({ sourceId, status: "pending" as const })),
  }));

/** Moves the matching pending source to the event's status; null when nothing would change. */
function applyToParts(
  parts: readonly RequestPart[],
  event: Pick<SourceStatusEvent, "partId" | "sourceId" | "status">,
): RequestPart[] | null {
  if (event.status === "pending") return null;
  let changed = false;
  const next = parts.map((part) => {
    if (part.partId !== event.partId) return part;
    return {
      ...part,
      sources: part.sources.map((source) => {
        if (source.sourceId !== event.sourceId || source.status !== "pending") return source;
        changed = true;
        return { ...source, status: event.status };
      }),
    };
  });
  return changed ? next : null;
}

/** Folds a fetched detail into the parts: forward status moves, payloads, origin, parent and reasons. */
function mergeDetail(
  parts: readonly RequestPart[],
  detail: QueryDetail,
): { parts: RequestPart[]; moved: boolean } | null {
  let changed = false;
  let moved = false;
  const next = parts.map((part) => {
    const fetched = detail.parts.find((p) => p.partId === part.partId);
    if (fetched === undefined) return part;
    const sources = part.sources.map((local) => {
      const remote = fetched.sources.find((r) => r.sourceId === local.sourceId);
      if (remote === undefined) return local;
      let status = local.status;
      if (local.status === "pending" && remote.status !== "pending") {
        status = remote.status;
        moved = true;
        changed = true;
      }
      if (local.result === undefined && remote.payload !== undefined && status === "returned") {
        changed = true;
        return { ...local, status, result: { payload: remote.payload } };
      }
      return status === local.status ? local : { ...local, status };
    });
    const same =
      part.origin === fetched.origin &&
      part.parentPartId === fetched.parentPartId &&
      JSON.stringify(part.skipReasons) === JSON.stringify(fetched.skipReasons);
    if (!same) changed = true;
    return same
      ? { ...part, sources }
      : {
          ...part,
          origin: fetched.origin,
          parentPartId: fetched.parentPartId,
          skipReasons: fetched.skipReasons,
          sources,
        };
  });
  return changed ? { parts: next, moved } : null;
}

/** A row for a request this list did not send, built from its detail alone. */
function placeholderParts(detail: QueryDetail): RequestPart[] {
  return detail.parts.map((part) => ({
    partId: part.partId,
    parentPartId: part.parentPartId,
    origin: part.origin,
    queryType: part.queryType,
    status: part.sources.length > 0 ? ("dispatched" as const) : ("skipped" as const),
    sourceIds: part.sources.map((source) => source.sourceId),
    droppedSourceIds: part.droppedSourceIds,
    skipReasons: part.skipReasons,
    sources: part.sources.map((source) => ({
      sourceId: source.sourceId,
      status: source.status,
      ...(source.status === "returned" && source.payload !== undefined
        ? { result: { payload: source.payload } }
        : {}),
    })),
  }));
}

/** Carries what a placeholder learned (settled statuses, payloads) onto the parts of the real 202. */
function overlay(
  parts: readonly RequestPart[],
  from: readonly RequestPart[],
): { parts: RequestPart[]; moved: boolean } {
  let moved = false;
  const next = parts.map((part) => {
    const known = from.find((p) => p.partId === part.partId);
    if (known === undefined) return part;
    return {
      ...part,
      sources: part.sources.map((local) => {
        const other = known.sources.find((s) => s.sourceId === local.sourceId);
        if (other === undefined) return local;
        const status = local.status === "pending" ? other.status : local.status;
        if (status !== local.status) moved = true;
        const result = local.result ?? (status === "returned" ? other.result : undefined);
        return { ...local, status, ...(result === undefined ? {} : { result }) };
      }),
    };
  });
  return { parts: next, moved };
}

/** The (part, source) pairs that have a payload in `after` and had none in `before`. */
function arrivals(
  correlationId: string,
  before: readonly RequestPart[],
  after: readonly RequestPart[],
): ResultArrival[] {
  return after.flatMap((part) =>
    part.sources.flatMap((source) => {
      if (source.result === undefined) return [];
      const was = before
        .find((p) => p.partId === part.partId)
        ?.sources.find((s) => s.sourceId === source.sourceId);
      return was?.result === undefined
        ? [{ correlationId, partId: part.partId, sourceId: source.sourceId }]
        : [];
    }),
  );
}

/** A shift's list stays useful at a glance; older rows fall off rather than grow without bound. */
const MAX_ROWS = 100;

/**
 * The requests this session has sent, in memory only (spec 6.7, SEC-006): the ResetController clears
 * them on sign-out, a 401 and a user change. Nothing here is written to any storage. A request
 * settles even if the panel that sent it has unmounted, because the list outlives the panel.
 */
export function createRequestsStore(options: { timers?: Timers } = {}): RequestsStore {
  const timers: Timers = options.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as number),
  };
  // Never reset: a stale outcome after a reset can then never match a row begun later.
  let counter = 0;
  const handlers = new Set<(announcement: StatusAnnouncement) => void>();
  const resultHandlers = new Set<(arrival: ResultArrival) => void>();
  // Per correlation ID: the open coalescing window, and events whose 202 has not landed yet.
  const windows = new Map<string, unknown>();
  const held = new Map<string, SourceStatusEvent[]>();
  // Correlation IDs of rows the list load added: history, so their detail fetches fill payloads
  // without a summary or a critical announcement (spec 6.6, FR-064). A live event or a live 202
  // for the request ends its history.
  const history = new Set<string>();
  const clearWindows = (): void => {
    for (const timer of windows.values()) timers.clearTimeout(timer);
    windows.clear();
  };
  const heldCount = (): number => {
    let count = 0;
    for (const list of held.values()) count += list.length;
    return count;
  };
  return createStore<RequestsState>((set, get) => {
    // A row that leaves the list inside its window (the 100-row cap, a replayed ack removing a retry
    // row) drops its summary on purpose: the request is no longer shown, so there is nothing to say
    // about it. The timer goes with it, so nothing fires for a row that is gone.
    const dropGoneWindows = (): void => {
      for (const [correlationId, timer] of windows) {
        const listed = get().items.some(
          (item) => item.status === "acknowledged" && item.correlationId === correlationId,
        );
        if (listed) continue;
        timers.clearTimeout(timer);
        windows.delete(correlationId);
      }
    };
    /** A row for a request this list did not send, built from its detail alone (spec 6.7). */
    const placeholderRow = (
      detail: QueryDetail,
    ): Extract<RequestEntry, { status: "acknowledged" }> | undefined => {
      const primary = detail.parts.find((part) => part.parentPartId === null) ?? detail.parts[0];
      if (primary === undefined) return undefined;
      counter += 1;
      return {
        id: `r${counter}`,
        sentAt: detail.submittedAt,
        queryType: primary.queryType,
        summary: "",
        placeholder: true,
        status: "acknowledged",
        correlationId: detail.correlationId,
        acknowledgedAt: detail.submittedAt,
        parts: placeholderParts(detail),
      };
    };
    const announceLater = (correlationId: string): void => {
      if (windows.has(correlationId)) return;
      windows.set(
        correlationId,
        timers.setTimeout(() => {
          windows.delete(correlationId);
          const entry = get().items.find(
            (item) => item.status === "acknowledged" && item.correlationId === correlationId,
          );
          if (entry?.status !== "acknowledged") return;
          const announcement = {
            correlationId,
            queryType: entry.queryType,
            summary: statusSummary(entry),
          };
          for (const handler of handlers) handler(announcement);
        }, COALESCE_MS),
      );
    };
    return {
      items: [],
      begin({ queryType, summary, submitted, idempotencyKey }) {
        counter += 1;
        const id = `r${counter}`;
        // A copy: the caller's objects (the draft's values) may change after the request left.
        const kept =
          submitted === undefined
            ? {}
            : {
                submitted: {
                  queryType: submitted.queryType,
                  values: { ...submitted.values },
                  sourceIds: [...submitted.sourceIds],
                  mode: submitted.mode,
                },
              };
        set((s) => ({
          items: [
            {
              id,
              sentAt: Date.now(),
              queryType,
              summary,
              ...kept,
              ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
              status: "sending" as const,
            },
            ...s.items,
          ].slice(0, MAX_ROWS),
        }));
        dropGoneWindows();
        return id;
      },
      settle(id, outcome, options) {
        let shownBy: string | undefined;
        let pendingAnnouncement: string | undefined;
        set((s) => {
          if (!s.items.some((item) => item.id === id)) return s;
          shownBy = id;
          if (options?.once === true && outcome.kind === "acknowledged") {
            const listed = s.items.find(
              (item) =>
                item.id !== id &&
                item.status === "acknowledged" &&
                item.placeholder !== true &&
                item.correlationId === outcome.response.correlationId,
            );
            if (listed !== undefined) {
              shownBy = listed.id;
              return { items: s.items.filter((item) => item.id !== id) };
            }
          }
          const placeholder =
            outcome.kind === "acknowledged"
              ? s.items.find(
                  (item) =>
                    item.id !== id &&
                    item.status === "acknowledged" &&
                    item.placeholder === true &&
                    item.correlationId === outcome.response.correlationId,
                )
              : undefined;
          const mapped = s.items.map((item): RequestEntry => {
            if (item.id !== id) return item;
            const base = {
              id: item.id,
              sentAt: item.sentAt,
              queryType: item.queryType,
              summary: item.summary,
              ...(item.submitted === undefined ? {} : { submitted: item.submitted }),
              ...(item.idempotencyKey === undefined ? {} : { idempotencyKey: item.idempotencyKey }),
              ...(item.superseded === undefined ? {} : { superseded: item.superseded }),
            };
            let filled: readonly RequestPart[] = [];
            if (outcome.kind === "acknowledged") {
              filled = withSources(outcome.response.parts);
              // Events that outran this 202 (spec 6.7) land now, once.
              const early = held.get(outcome.response.correlationId) ?? [];
              held.delete(outcome.response.correlationId);
              // Only an event that moved a source is worth a summary: events for pairs this 202
              // does not have change nothing and must not announce "0 of N done".
              for (const event of early) {
                const applied = applyToParts(filled, event);
                if (applied === null) continue;
                filled = applied;
                pendingAnnouncement = outcome.response.correlationId;
              }
              // A placeholder the detail fetch built for this request (spec 6.7) hands over what it learned.
              if (placeholder?.status === "acknowledged") {
                history.delete(outcome.response.correlationId);
                const merged = overlay(filled, placeholder.parts);
                filled = merged.parts;
                if (merged.moved) pendingAnnouncement = outcome.response.correlationId;
              }
            }
            return outcome.kind === "acknowledged"
              ? {
                  ...base,
                  status: "acknowledged",
                  correlationId: outcome.response.correlationId,
                  acknowledgedAt: outcome.response.acknowledgedAt,
                  parts: filled,
                }
              : { ...base, status: "failed", failure: outcome.kind };
          });
          return {
            items:
              placeholder === undefined ? mapped : mapped.filter((item) => item !== placeholder),
          };
        });
        dropGoneWindows();
        if (pendingAnnouncement !== undefined) announceLater(pendingAnnouncement);
        return shownBy;
      },
      applyEvent(event) {
        const entry = get().items.find(
          (item) => item.status === "acknowledged" && item.correlationId === event.correlationId,
        );
        if (entry?.status !== "acknowledged") {
          // A pending event changes nothing (applyToParts ignores it), and held it would block a
          // later terminal one for the same pair.
          if (event.status === "pending") return;
          // Not acknowledged yet (the event outran the 202): hold it, bounded in requests, in events
          // per request and in events overall. A pair already held keeps its first event: a terminal
          // status is written once, so a repeat could never change anything.
          const list = held.get(event.correlationId) ?? [];
          const repeat = list.some(
            (h) => h.partId === event.partId && h.sourceId === event.sourceId,
          );
          if (!repeat && list.length < MAX_HELD_PER_REQUEST) list.push(event);
          held.delete(event.correlationId);
          held.set(event.correlationId, list);
          for (const key of held.keys()) {
            if (held.size <= MAX_HELD_REQUESTS && heldCount() <= MAX_HELD_EVENTS) break;
            held.delete(key);
          }
          return;
        }
        const parts = applyToParts(entry.parts, event);
        if (parts === null) return;
        history.delete(event.correlationId);
        set((s) => ({
          items: s.items.map(
            (item): RequestEntry => (item.id === entry.id ? { ...entry, parts } : item),
          ),
        }));
        announceLater(event.correlationId);
      },
      applyDetail(detail) {
        const entry = get().items.find(
          (item) => item.status === "acknowledged" && item.correlationId === detail.correlationId,
        );
        if (entry?.status !== "acknowledged") {
          const row = placeholderRow(detail);
          if (row === undefined) return;
          set((s) => ({ items: [row, ...s.items].slice(0, MAX_ROWS) }));
          dropGoneWindows();
          if (statusSummary(row).done > 0) announceLater(detail.correlationId);
          for (const arrival of arrivals(detail.correlationId, [], row.parts)) {
            for (const handler of resultHandlers) handler(arrival);
          }
          return;
        }
        const merged = mergeDetail(entry.parts, detail);
        if (merged === null) return;
        set((s) => ({
          items: s.items.map(
            (item): RequestEntry =>
              item.id === entry.id ? { ...entry, parts: merged.parts } : item,
          ),
        }));
        // History: the payload fills quietly, nothing is spoken for an old request.
        if (history.has(detail.correlationId)) return;
        const landed = arrivals(detail.correlationId, entry.parts, merged.parts);
        // A payload that lands after the window closed (a slow fetch) still earns a summary, so its
        // severity keyword is spoken politely (spec 6.6). An open window already covers it.
        if (merged.moved || landed.length > 0) announceLater(detail.correlationId);
        for (const arrival of landed) {
          for (const handler of resultHandlers) handler(arrival);
        }
      },
      applyList(requests) {
        const moved: string[] = [];
        set((s) => {
          let items = s.items;
          let changed = false;
          for (const request of requests) {
            const found = items.find(
              (item) =>
                item.status === "acknowledged" && item.correlationId === request.correlationId,
            );
            if (found?.status === "acknowledged") {
              const merged = mergeDetail(found.parts, request);
              if (merged === null) continue;
              items = items.map(
                (item): RequestEntry => (item === found ? { ...found, parts: merged.parts } : item),
              );
              changed = true;
              if (merged.moved) moved.push(request.correlationId);
              continue;
            }
            const row = placeholderRow(request);
            if (row === undefined) continue;
            history.add(request.correlationId);
            // By time: above the first row that began earlier. The rows already shown stay as they are.
            const at = items.findIndex((item) => item.sentAt < row.sentAt);
            items = at === -1 ? [...items, row] : [...items.slice(0, at), row, ...items.slice(at)];
            changed = true;
          }
          return changed ? { items: items.slice(0, MAX_ROWS) } : s;
        });
        dropGoneWindows();
        for (const correlationId of moved) announceLater(correlationId);
      },
      onStatusSummary(handler) {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
      onResult(handler) {
        resultHandlers.add(handler);
        return () => {
          resultHandlers.delete(handler);
        };
      },
      supersede(id) {
        set((s) => ({
          items: s.items.map(
            (item): RequestEntry =>
              item.id === id && item.status === "failed" ? { ...item, superseded: true } : item,
          ),
        }));
      },
      reset() {
        clearWindows();
        held.clear();
        history.clear();
        set({ items: [] });
      },
    };
  });
}
