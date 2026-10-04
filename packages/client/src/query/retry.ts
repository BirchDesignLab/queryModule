import type { RequestEntry, RequestsStore } from "./requests.js";
import type { SubmitController, SubmitOutcome } from "./submit.js";

/** A failed row whose values were kept, and whose failure the same values could get past. */
export function isRetryable(entry: RequestEntry): boolean {
  if (entry.status !== "failed" || entry.submitted === undefined) return false;
  // Its retry was acknowledged: the request is listed as acknowledged already (M1 exit C1).
  if (entry.superseded === true) return false;
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
 * config hash. The failed row stays. A retry is the same request (FR-064, spec 5.2 step 1, 6.7), so
 * it goes under the failed row's own Idempotency-Key whatever the failure was: a request that got no
 * answer, a gateway error or a 429 may still have been stored, and the server answers a known key
 * with the original acknowledgment rather than running the query twice. The new row keeps the same
 * key. Once the retry is acknowledged the failed row is superseded and cannot be retried again, and
 * an ack whose correlation ID is already listed adds no second row (M1 exit C1). A row without one (none was kept) gets a fresh key. Memory only; nothing is announced or focused here (the caller
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
  const idempotencyKey =
    entry.idempotencyKey ?? deps.submit.getState().keyFor({ ...entry.submitted, configHash });
  const newRow = deps.requests.getState().begin({
    queryType: entry.queryType,
    summary: entry.summary,
    submitted: entry.submitted,
    idempotencyKey,
  });
  const outcome = await deps.submit
    .getState()
    .submit({ ...entry.submitted, idempotencyKey, configHash });
  // The list outlives the panel, so the row settles even if the panel has unmounted. A replayed
  // ack already listed keeps its one row, and the result points at it.
  const shownBy = deps.requests.getState().settle(newRow, outcome, { once: true }) ?? newRow;
  if (outcome.kind === "acknowledged") deps.requests.getState().supersede(rowId);
  return { kind: "sent", outcome, rowId: shownBy };
}
