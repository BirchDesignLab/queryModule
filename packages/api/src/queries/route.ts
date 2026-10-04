import {
  type Role,
  type SubmitQueryResponse,
  SubmitQueryResponseSchema,
} from "@querymodule/core/contracts";
import type { Hono } from "hono";
import type { AppDeps } from "../deps";
import { apiError } from "../http/errors";
import { requireSession } from "../http/session";
import type { AppEnv } from "../http/types";
import { acknowledge } from "./acknowledge";
import { admitSubmit, replayResponse } from "./admission";
import { sanitizeSubmitError } from "./errors";
import { prepareSubmit } from "./prepare";

export { SubmitTransactionError, sanitizeSubmitError } from "./errors";

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

/**
 * The roles that may submit a query (ADR-0011 item 6, checker ruling 09-29-26; #505 T27 Q2): an
 * allowlist, so implementer (config only) and any role added later are refused until listed.
 */
export const QUERY_ROLES: readonly Role[] = ["user", "trainingOfficer", "admin"];

export const mayQuery = (role: string): boolean =>
  (QUERY_ROLES as readonly string[]).includes(role);

/**
 * POST /api/v1/queries (spec 5.2 steps 1 to 4), mounted after the body cap and the
 * X-Requested-With check. Nothing from the body is logged; any other throw reaches
 * app.onError as 500 internal, a T1 failure only as a SubmitTransactionError. A role outside
 * QUERY_ROLES gets 403 before anything is read.
 */
export function mountQueriesRoute(app: Hono<AppEnv>, d: AppDeps): void {
  app.post("/api/v1/queries", requireSession(d.identity), async (c) => {
    if (!mayQuery(c.get("principal").role)) return apiError(c, "forbidden");
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
