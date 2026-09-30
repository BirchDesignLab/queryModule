import { createStore, type StoreApi } from "zustand/vanilla";
import type { SubmitOutcome, SubmitQueryResponse } from "./submit.js";

/** Why a request did not reach an acknowledgment: the submit outcome's kind, translated at render. */
export type RequestFailure = Exclude<SubmitOutcome["kind"], "acknowledged">;

interface RequestBase {
  /** A local key, never reused, so a row keeps its identity from Sending to its final state. */
  id: string;
  queryType: string;
  /** The command the request was built as; shown in mono. Memory only, cleared with the session. */
  summary: string;
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
  begin(request: { queryType: string; summary: string }): string;
  /** Turns the row into Acknowledged or Failed; a row a reset already cleared is ignored. */
  settle(id: string, outcome: SubmitOutcome): void;
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
    begin({ queryType, summary }) {
      counter += 1;
      const id = `r${counter}`;
      set((s) => ({
        items: [{ id, queryType, summary, status: "sending" as const }, ...s.items].slice(
          0,
          MAX_ROWS,
        ),
      }));
      return id;
    },
    settle(id, outcome) {
      set((s) => ({
        items: s.items.map((item): RequestEntry => {
          if (item.id !== id) return item;
          const base = { id: item.id, queryType: item.queryType, summary: item.summary };
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
      }));
    },
    reset() {
      set({ items: [] });
    },
  }));
}
