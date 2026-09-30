import type { RequestEntry, RequestsStore } from "./requests.js";
import type { SubmitController, SubmitOutcome } from "./submit.js";

/** A failed row whose values were kept, and whose failure the same values could get past. */
export function isRetryable(entry: RequestEntry): boolean {
  if (entry.status !== "failed" || entry.submitted === undefined) return false;
  // The server refused these values or this user, or the form itself changed under the request
  // ("check the form and submit again"): sending the same values again cannot help.
  return (
    entry.failure !== "invalid" &&
    entry.failure !== "forbidden" &&
    entry.failure !== "configChanged"
  );
}

export type RetryResult =
  | { kind: "sent"; outcome: SubmitOutcome; rowId: string }
  /** A request is in flight or the connection is down: nothing was sent (spec 6.8). */
  | { kind: "gated"; status: "submitting" | "noConnection" }
  /** The row is gone (a reset) or cannot be retried. */
  | { kind: "unavailable" };

/**
 * Sends a failed row's stored values again as a new attempt and adds a new row, under the current
 * config hash. The failed row stays. The submit controller keeps the Idempotency-Key rule (spec
 * 6.7): a request that got no answer is retried under its own key, so a server that did receive it
 * answers with the original acknowledgment rather than running the query twice; any answered
 * failure got a new key already. Memory only; nothing is announced or focused here (the caller
 * speaks through the shared announcer).
 */
export async function retryRequest(
  deps: { requests: RequestsStore; submit: SubmitController },
  rowId: string,
  configHash: string,
): Promise<RetryResult> {
  const entry = deps.requests.getState().items.find((item) => item.id === rowId);
  if (entry === undefined || !isRetryable(entry) || entry.submitted === undefined)
    return { kind: "unavailable" };
  const status = deps.submit.getState().status;
  if (status !== "idle") return { kind: "gated", status };
  const newRow = deps.requests
    .getState()
    .begin({ queryType: entry.queryType, summary: entry.summary, submitted: entry.submitted });
  const outcome = await deps.submit.getState().submit({ ...entry.submitted, configHash });
  // The list outlives the panel, so the row settles even if the panel has unmounted.
  deps.requests.getState().settle(newRow, outcome);
  return { kind: "sent", outcome, rowId: newRow };
}
