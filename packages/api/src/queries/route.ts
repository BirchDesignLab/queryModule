import { type Role, SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import type { Hono } from "hono";
import type { AppDeps } from "../deps";
import type { DispatchJob } from "../dispatch/dispatcher";
import { apiError } from "../http/errors";
import { requireSession } from "../http/session";
import type { AppEnv } from "../http/types";
import { errorFields } from "../log/error-fields";
import { actorOf, type Principal } from "../seams";
import { type Acknowledged, acknowledge } from "./acknowledge";
import { admitSubmit, replayResponse } from "./admission";
import { sanitizeSubmitError } from "./errors";
import { type PreparedSubmit, prepareSubmit } from "./prepare";

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

/** A dispatch job before T1: everything but the ids and the deadline T1 fixes. */
export type JobTemplate = Omit<DispatchJob, "correlationId" | "resultId" | "deadline"> & {
  timeoutMs: number;
};

/**
 * One planned job per dispatch pair, in pair order (spec 5.2 step 5): the part's values and type
 * values from prepare's plan (D-A13), the pair's credential owner, timeoutMs and
 * requiresCredentials from the snapshot prepare pinned, never the live config, and the requester's
 * audit envelope, the same one T1 writes (spec 4.7, SEC-010). Runs before T1, so a guard that
 * trips is a 500 with nothing committed (AW3 critic b).
 */
export function planJobs(p: PreparedSubmit, principal: Principal): JobTemplate[] {
  return p.pairs.map((pair) => {
    const part = p.plan.parts.find((x) => x.partId === pair.partId);
    if (!part) throw new Error("dispatch: pair has no plan part");
    const source = p.config.siteConfig.sources.find((s) => s.id === pair.sourceId);
    if (!source) throw new Error("dispatch: pair has no source config");
    return {
      partId: pair.partId,
      sourceId: pair.sourceId,
      userId: principal.userId,
      actor: actorOf(principal),
      identitySource: principal.identitySource,
      ...(principal.hostSubject ? { hostSubject: principal.hostSubject } : {}),
      queryType: part.queryType,
      types: part.typeValues,
      values: part.values,
      snapshot: p.config,
      adapterKind: pair.adapterKind,
      credentialUserId: pair.credentialUserId,
      delegationId: pair.delegationId,
      requiresCredentials: source.requiresCredentials,
      timeoutMs: source.timeoutMs,
    };
  });
}

/**
 * T1's results bound to the planned jobs by index (acknowledge writes one row per pair, in pair
 * order); a replay's empty results bind nothing. A result that does not line up with its pair is
 * a bug, thrown for the route's post-commit backstop.
 */
export function bindJobs(templates: readonly JobTemplate[], ack: Acknowledged): DispatchJob[] {
  return ack.results.map((r, i) => {
    const t = templates[i];
    if (!t || t.partId !== r.partId || t.sourceId !== r.sourceId) {
      throw new Error("dispatch: result does not match its pair");
    }
    const { timeoutMs, ...job } = t;
    return {
      ...job,
      correlationId: ack.body.correlationId,
      resultId: r.resultId,
      deadline: ack.acknowledgedAt + timeoutMs,
    };
  });
}

/**
 * POST /api/v1/queries (spec 5.2 steps 1 to 4), mounted after the body cap and the
 * X-Requested-With check. Nothing from the body is logged; any other throw reaches
 * app.onError as 500 internal, a T1 failure only as a SubmitTransactionError. A role outside
 * QUERY_ROLES gets 403 before anything is read. Jobs are planned before T1 (a guard that trips is
 * a 500 with nothing committed) and bound to T1's rows as soon as it returns, before the body is
 * parsed; a throw there is logged by class and ids and fails closed (d.fatal), so committed rows
 * are never silently left undispatched. The 202 never waits on dispatch (spec 5.2 step 5). A lost idempotency race replays the winner and enqueues
 * nothing: the winner enqueued its own rows.
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
    const templates = planJobs(p.value, principal);
    let ack: Acknowledged;
    try {
      ack = await acknowledge(d, principal, p.value, a);
    } catch (e) {
      if (!lostIdempotencyRace(e)) throw sanitizeSubmitError(e);
      const winner = await replayResponse(d.db, principal.userId, a.idempotencyKey);
      if (winner === null) throw sanitizeSubmitError(e);
      ack = { body: winner, acknowledgedAt: winner.acknowledgedAt, results: [] };
    }
    try {
      d.dispatcher.enqueue(bindJobs(templates, ack));
    } catch (e) {
      // Backstop (AW3 critic b): T1 committed, so the 202 stands; the process fails closed and the
      // restart sweep settles the pending rows as interrupted, with audit (spec 5.2, 8.1).
      d.logger.error("dispatch jobs failed", {
        correlationId: ack.body.correlationId,
        error: { name: errorFields(e).name },
      });
      d.fatal(e);
    }
    return c.json(SubmitQueryResponseSchema.parse(ack.body), 202);
  });
}
