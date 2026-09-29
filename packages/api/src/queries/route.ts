import { type SubmitQueryResponse, SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import type { Hono } from "hono";
import type { AppDeps } from "../deps";
import { requireSession } from "../http/session";
import type { AppEnv } from "../http/types";
import { acknowledge } from "./acknowledge";
import { admitSubmit, replayResponse } from "./admission";
import { prepareSubmit } from "./prepare";

/**
 * The idempotency guard a concurrent duplicate trips when it loses the race (spec 5.2 step 1):
 * migration 0005's BEFORE INSERT trigger, or the query_request_idempotency_idx UNIQUE index
 * behind it. Only the driver's own error is read: drizzle's wrapper message quotes the params.
 */
const IDEMPOTENCY_RACE =
  /query_request idempotency key exists|UNIQUE constraint failed: query_request\.user_id, query_request\.idempotency_key/;

export function lostIdempotencyRace(e: unknown): boolean {
  for (let x: unknown = e; x instanceof Error; x = x.cause) {
    if (x.name !== "DrizzleQueryError" && IDEMPOTENCY_RACE.test(x.message)) return true;
  }
  return false;
}

/** Driver result codes are fixed tokens such as SQLITE_CONSTRAINT, never data. */
const DRIVER_CODE = /^SQLITE_[A-Z_]+$/;

/**
 * The only error a failed T1 hands to app.onError (spec 5.9, SEC-006). drizzle's wrapper
 * message quotes every insert param: wrapped DEKs, sealed values, ids and the Idempotency-Key.
 * This keeps just a fixed message and the driver's result code, with no cause.
 */
export class SubmitTransactionError extends Error {
  override name = "SubmitTransactionError";
  constructor(code: string | null) {
    super(code ? `submit transaction failed (${code})` : "submit transaction failed");
  }
}

export function sanitizeSubmitError(e: unknown): SubmitTransactionError {
  for (let x: unknown = e; x instanceof Error; x = x.cause) {
    const code: unknown = (x as { code?: unknown }).code;
    if (typeof code === "string" && DRIVER_CODE.test(code)) return new SubmitTransactionError(code);
  }
  return new SubmitTransactionError(null);
}

/**
 * POST /api/v1/queries (spec 5.2 steps 1 to 4), mounted after the body cap and the
 * X-Requested-With check. Nothing from the body is logged; any other throw reaches
 * app.onError as 500 internal, a T1 failure only as a SubmitTransactionError.
 */
export function mountQueriesRoute(app: Hono<AppEnv>, d: AppDeps): void {
  app.post("/api/v1/queries", requireSession(d.identity), async (c) => {
    const a = await admitSubmit(c, d);
    if (a.kind === "reject") return a.response;
    if (a.kind === "replay") return c.json(a.body, 202);
    const principal = c.get("principal");
    const p = prepareSubmit(c, d, a.raw, principal);
    if (!p.ok) return p.response;
    let body: SubmitQueryResponse;
    try {
      body = await acknowledge(d, principal, p.value, a);
    } catch (e) {
      if (!lostIdempotencyRace(e)) throw sanitizeSubmitError(e);
      const winner = await replayResponse(d.db, principal.userId, a.idempotencyKey);
      if (winner === null) throw sanitizeSubmitError(e);
      body = winner;
    }
    return c.json(SubmitQueryResponseSchema.parse(body), 202);
  });
}
