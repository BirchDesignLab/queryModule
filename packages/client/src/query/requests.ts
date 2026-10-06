import type { SourceStatus } from "@querymodule/core/contracts";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { SourceStatusEvent } from "../feed/feed-socket.js";
import type { SubmitOutcome, SubmitQueryResponse, SubmitRequest } from "./submit.js";

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
}

/** One source a part went to and where it stands; status only, never a value or a payload. */
export interface RequestSource {
  sourceId: string;
  status: SourceStatus;
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
  /** One call per correlation ID per 1500 ms window that changed something; returns the unsubscribe. */
  onStatusSummary(handler: (announcement: StatusAnnouncement) => void): () => void;
  reset(): void;
}

export type RequestsStore = StoreApi<RequestsState>;

/** Status changes for one request within this window are announced as one summary (spec 6.6). */
const COALESCE_MS = 1500;
/** Events that outran their 202 are held for this many requests; older ones are dropped. */
const MAX_HELD_REQUESTS = 50;

/** Counts of a request's sources by status, over every dispatched part. */
export function statusSummary(
  entry: Extract<RequestEntry, { status: "acknowledged" }>,
): StatusSummary {
  const byStatus: Partial<Record<SourceStatus, number>> = {};
  let done = 0;
  let total = 0;
  for (const part of entry.parts) {
    for (const source of part.sources) {
      total += 1;
      if (source.status !== "pending") done += 1;
      byStatus[source.status] = (byStatus[source.status] ?? 0) + 1;
    }
  }
  return { done, total, byStatus };
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

/** A shift's list stays useful at a glance; older rows fall off rather than grow without bound. */
const MAX_ROWS = 100;

/**
 * The requests this session has sent, in memory only (spec 6.7, SEC-006): the ResetController clears
 * them on sign-out, a 401 and a user change. Nothing here is written to any storage. A request
 * settles even if the panel that sent it has unmounted, because the list outlives the panel.
 */
export function createRequestsStore(): RequestsStore {
  // Never reset: a stale outcome after a reset can then never match a row begun later.
  let counter = 0;
  const handlers = new Set<(announcement: StatusAnnouncement) => void>();
  // Per correlation ID: the open coalescing window, and events whose 202 has not landed yet.
  const windows = new Map<string, unknown>();
  const held = new Map<string, SourceStatusEvent[]>();
  const clearWindows = (): void => {
    for (const timer of windows.values()) globalThis.clearTimeout(timer as number);
    windows.clear();
  };
  return createStore<RequestsState>((set, get) => {
    const announceLater = (correlationId: string): void => {
      if (windows.has(correlationId)) return;
      windows.set(
        correlationId,
        globalThis.setTimeout(() => {
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
              queryType,
              summary,
              ...kept,
              ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
              status: "sending" as const,
            },
            ...s.items,
          ].slice(0, MAX_ROWS),
        }));
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
                item.correlationId === outcome.response.correlationId,
            );
            if (listed !== undefined) {
              shownBy = listed.id;
              return { items: s.items.filter((item) => item.id !== id) };
            }
          }
          return {
            items: s.items.map((item): RequestEntry => {
              if (item.id !== id) return item;
              const base = {
                id: item.id,
                queryType: item.queryType,
                summary: item.summary,
                ...(item.submitted === undefined ? {} : { submitted: item.submitted }),
                ...(item.idempotencyKey === undefined
                  ? {}
                  : { idempotencyKey: item.idempotencyKey }),
                ...(item.superseded === undefined ? {} : { superseded: item.superseded }),
              };
              let filled: readonly RequestPart[] = [];
              if (outcome.kind === "acknowledged") {
                filled = withSources(outcome.response.parts);
                // Events that outran this 202 (spec 6.7) land now, once.
                const early = held.get(outcome.response.correlationId) ?? [];
                held.delete(outcome.response.correlationId);
                for (const event of early) filled = applyToParts(filled, event) ?? filled;
                if (early.length > 0) pendingAnnouncement = outcome.response.correlationId;
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
            }),
          };
        });
        if (pendingAnnouncement !== undefined) announceLater(pendingAnnouncement);
        return shownBy;
      },
      applyEvent(event) {
        const entry = get().items.find(
          (item) => item.status === "acknowledged" && item.correlationId === event.correlationId,
        );
        if (entry?.status !== "acknowledged") {
          // Not acknowledged yet (the event outran the 202): hold it, for a bounded number of requests.
          const list = held.get(event.correlationId) ?? [];
          list.push(event);
          held.delete(event.correlationId);
          held.set(event.correlationId, list);
          for (const key of held.keys()) {
            if (held.size <= MAX_HELD_REQUESTS) break;
            held.delete(key);
          }
          return;
        }
        const parts = applyToParts(entry.parts, event);
        if (parts === null) return;
        set((s) => ({
          items: s.items.map(
            (item): RequestEntry => (item.id === entry.id ? { ...entry, parts } : item),
          ),
        }));
        announceLater(event.correlationId);
      },
      onStatusSummary(handler) {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
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
        set({ items: [] });
      },
    };
  });
}
