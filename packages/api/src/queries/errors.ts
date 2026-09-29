/** Driver result codes are fixed tokens such as SQLITE_CONSTRAINT, never data. */
const DRIVER_CODE = /^SQLITE_[A-Z_]+$/;

/**
 * The only error a failed T1 or replay hands to app.onError (spec 5.9, SEC-006). drizzle's
 * wrapper message quotes every param: wrapped DEKs, sealed values, ids and the Idempotency-Key.
 * This keeps just a fixed message and the driver's result code, with no cause.
 */
export class SubmitTransactionError extends Error {
  override name = "SubmitTransactionError";
  constructor(code: string | null, step: SubmitStep = "transaction") {
    super(code ? `submit ${step} failed (${code})` : `submit ${step} failed`);
  }
}

/** transaction: T1 (spec 5.2 step 4); replay: the Idempotency-Key read-back (step 1, #317 C-m1). */
export type SubmitStep = "transaction" | "replay";

export function sanitizeSubmitError(
  e: unknown,
  step: SubmitStep = "transaction",
): SubmitTransactionError {
  for (let x: unknown = e; x instanceof Error; x = x.cause) {
    const code: unknown = (x as { code?: unknown }).code;
    if (typeof code === "string" && DRIVER_CODE.test(code))
      return new SubmitTransactionError(code, step);
  }
  return new SubmitTransactionError(null, step);
}
