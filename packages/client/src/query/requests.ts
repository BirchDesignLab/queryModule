import { createStore, type StoreApi } from "zustand/vanilla";
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

export type RequestEntry = RequestBase &
  (
    | { status: "sending" }
    | {
        status: "acknowledged";
        correlationId: string;
        /** Epoch milliseconds, from the 202. */
        acknowledgedAt: number;
        parts: SubmitQueryResponse["parts"];
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
  reset(): void;
}

export type RequestsStore = StoreApi<RequestsState>;

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
  return createStore<RequestsState>((set) => ({
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
              ...(item.idempotencyKey === undefined ? {} : { idempotencyKey: item.idempotencyKey }),
              ...(item.superseded === undefined ? {} : { superseded: item.superseded }),
            };
            return outcome.kind === "acknowledged"
              ? {
                  ...base,
                  status: "acknowledged",
                  correlationId: outcome.response.correlationId,
                  acknowledgedAt: outcome.response.acknowledgedAt,
                  parts: outcome.response.parts,
                }
              : { ...base, status: "failed", failure: outcome.kind };
          }),
        };
      });
      return shownBy;
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
      set({ items: [] });
    },
  }));
}
