import { type AuditActor, type Role, SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { session, user } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { apiError, rateLimited } from "../http/errors";
import type { AppEnv } from "../http/types";
import { actorOf } from "../seams";
import { clearSessionCookie } from "./auth";
import { auditEmail, BACKGROUND_HEADER } from "./identity";
import { AUTH_LIMITS, clientIp } from "./rate-limit";

type LoginFailReason = "badPassword" | "unknownAccount" | "lockedOut" | "accountDisabled";

// The only Better Auth paths this app forwards to (critic:C3): every other Better Auth path
// (revoke-session, revoke-sessions, revoke-other-sessions, change-password, sign-up, ...) would
// end or change a session with no sessionRevoked/logout audit row and no eventBus.endSession,
// breaking spec 5.6/4.7/SEC-010. Add a path here only once it has its own audit and
// eventBus.endSession wiring, like sign-in/email and sign-out below. change-password (D-A26)
// ends no session: changePassword() refuses revokeOtherSessions, the one option that would.
const ALLOWED_AUTH_PATHS = new Set([
  "/api/v1/auth/sign-in/email",
  "/api/v1/auth/sign-out",
  "/api/v1/auth/get-session",
  "/api/v1/auth/change-password",
]);

export function mountAuthRoutes(app: Hono<AppEnv>, d: AppDeps): void {
  app.all("/api/v1/auth/*", async (c) => {
    if (!d.env.identityModes.includes("standalone")) return apiError(c, "notFound");
    if (!ALLOWED_AUTH_PATHS.has(c.req.path)) return apiError(c, "notFound");
    const ip = clientIp(c, d.env);
    if (c.req.method === "POST") {
      const gate = await d.limiter.hit(
        `login:ip:${ip}`,
        AUTH_LIMITS.ipRequests.limit,
        AUTH_LIMITS.ipRequests.windowMs,
      );
      if (!gate.allowed) return rateLimited(c, gate.retryAfterSeconds);
      if (c.req.path === "/api/v1/auth/sign-in/email") return signIn(c, d, ip);
      if (c.req.path === "/api/v1/auth/sign-out") return signOut(c, d);
      if (c.req.path === "/api/v1/auth/change-password") return changePassword(c, d);
    }
    return d.auth.handler(c.req.raw);
  });
}

async function auditFailure(
  d: AppDeps,
  targetUserId: string | null,
  reason: LoginFailReason,
  clientIpValue: string,
  lockoutUntil: number | null,
) {
  await withTransaction(d.db, (tx) =>
    d.audit.record(tx, {
      type: "loginFailed",
      actor: SYSTEM_ACTOR,
      identitySource: "system",
      details: {
        targetUserId,
        reason,
        clientIp: clientIpValue,
        ...(lockoutUntil !== null ? { lockoutUntil } : {}),
      },
    }),
  );
}

/** Better Auth's error code on a non-2xx sign-in response, or undefined. */
async function signInErrorCode(res: Response): Promise<unknown> {
  return (
    (await res
      .clone()
      .json()
      .catch(() => null)) as { code?: unknown } | null
  )?.code;
}

/** A 401 that means wrong email or password, not an internal failure inside Better Auth. */
async function isBadCredentials(res: Response): Promise<boolean> {
  return (await signInErrorCode(res)) === "INVALID_EMAIL_OR_PASSWORD";
}

async function internalSignInFailure(
  c: Context<AppEnv>,
  d: AppDeps,
  res: Response,
): Promise<Response> {
  const code = await signInErrorCode(res);
  d.logger.error("sign-in failed inside Better Auth", {
    code: typeof code === "string" ? code : "unknown",
  });
  return apiError(c, "internal");
}

/**
 * AUD-2: drops a session whose loginSucceeded row failed to commit, and returns the delete
 * error's name, or null. A failed delete still answers 500: the cookie was never sent, and the
 * row expires on its own limits.
 */
async function deleteUnauditedSession(d: AppDeps, sessionId: string): Promise<string | null> {
  try {
    await d.db.delete(session).where(eq(session.id, sessionId));
    return null;
  } catch (e) {
    return e instanceof Error ? e.name : typeof e;
  }
}

async function signIn(c: Context<AppEnv>, d: AppDeps, ip: string): Promise<Response> {
  // critic:C1 / critic:CV1: Better Auth's sign-in/email also accepts
  // application/x-www-form-urlencoded (better-call parses both), which would give email "" here
  // and skip the account lock entirely. Reject anything but JSON, and an empty or missing email,
  // before any lookup: never call the Better Auth handler without a normalized email.
  const contentType = (c.req.header("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) return apiError(c, "validationFailed");
  const body = (await c.req.raw
    .clone()
    .json()
    .catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return apiError(c, "validationFailed");
  const key = `login:acct:${email}`;
  const target = (await d.db.select().from(user).where(eq(user.email, email)))[0] ?? null;
  const locked = await d.limiter.lockedUntil(key);
  if (locked !== null) {
    await auditFailure(d, target?.id ?? null, "lockedOut", ip, null);
    return rateLimited(c, (locked - d.clock.now()) / 1000);
  }
  const res = await d.auth.handler(c.req.raw);
  // A disabled account never gets a session (D-A26). It runs through Better Auth's own handler
  // like any account (rr:N-I1): the same body validation (a malformed body is the same 400, with
  // no lockout count) and the same credential check (no timing difference, G-I2). A session that
  // a right password created is deleted before answering, and its cookie never leaves; every
  // credential outcome answers Better Auth's bad-credentials 401, counts toward the account
  // lockout (the same 429 after N failures) and audits accountDisabled (C-I1).
  if (target?.disabledAt != null && (res.ok || res.status === 401)) {
    // Disable deleted the user's sessions, so any row here is one a sign-in made after disable
    // (this one, or an orphan an earlier failed delete left); drop every one by user id. A failed
    // delete still answers the same 401 (#505 G-m2) and can leave the row behind: identity
    // refuses a disabled user's session, so it is never live. A future enable-user path must
    // delete the user's sessions in the same transaction that clears disabledAt, or such an
    // orphan row would come back to life (#513 G-M1). Only the error name is logged (spec 5.9).
    if (res.ok) {
      try {
        await d.db.delete(session).where(eq(session.userId, target.id));
      } catch (e) {
        d.logger.error("disabled sign-in session delete failed", {
          errorName: e instanceof Error ? e.name : typeof e,
        });
      }
    } else if (!(await isBadCredentials(res))) {
      return internalSignInFailure(c, d, res);
    }
    const { lockedUntil } = await d.limiter.recordFailure(key, AUTH_LIMITS.accountFailures);
    await auditFailure(d, target.id, "accountDisabled", ip, lockedUntil);
    return c.json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401);
  }
  if (res.ok) {
    const token = ((await res.clone().json()) as { token?: string }).token ?? "";
    const s = (
      await d.db.select({ id: session.id }).from(session).where(eq(session.token, token))
    )[0];
    if (!s || !target) throw new Error("sign-in succeeded without a session row");
    try {
      await withTransaction(d.db, (tx) =>
        d.audit.record(tx, {
          type: "loginSucceeded",
          actor: { id: target.id, email: auditEmail(target.email), role: target.role },
          identitySource: "local",
          details: { method: "password", sessionId: s.id, clientIp: ip },
        }),
      );
    } catch (e) {
      // AUD-2 (SEC-010): no session lives without its loginSucceeded row. Better Auth already
      // inserted it, so it is deleted and its cookie never leaves; the lockout count stays.
      // Fixed text and the error's name only: a query error's message carries its params.
      // M1 exit Q2: logged after the delete, with its actual outcome.
      const errorName = e instanceof Error ? e.name : typeof e;
      const deleteErrorName = await deleteUnauditedSession(d, s.id);
      if (deleteErrorName === null)
        d.logger.error("sign-in audit failed; session deleted", { sessionId: s.id, errorName });
      else
        d.logger.error("sign-in audit failed; session delete failed", {
          sessionId: s.id,
          errorName,
          deleteErrorName,
        });
      return apiError(c, "internal");
    }
    await d.limiter.reset(key);
    return res;
  }
  if (res.status === 401) {
    // #212 G-M2: only bad credentials count toward the lockout and audit as badPassword or
    // unknownAccount. Any other 401 (for example FAILED_TO_CREATE_SESSION after a correct
    // password) is an internal failure: no lockout increment and no loginFailed row.
    if (!(await isBadCredentials(res))) return internalSignInFailure(c, d, res);
    const { lockedUntil } = await d.limiter.recordFailure(key, AUTH_LIMITS.accountFailures);
    await auditFailure(
      d,
      target?.id ?? null,
      target ? "badPassword" : "unknownAccount",
      ip,
      lockedUntil,
    );
  }
  return res;
}

/**
 * D-A26: Better Auth's change-password with revokeOtherSessions would delete the user's other
 * sessions with no sessionRevoked row and no eventBus.endSession (SEC-010), so that option is
 * refused. The session must be live by the app's own limits, idle clock included (G-m2: Better
 * Auth checks only the absolute limit). A new password equal to the current one is refused
 * (G-I4): it would clear the forced-change flag while the admin-issued password stays valid.
 * Every other body goes to Better Auth, which verifies the current password and clears
 * must_change_password through the hook in auth.ts.
 */
async function changePassword(c: Context<AppEnv>, d: AppDeps): Promise<Response> {
  if (!(await d.identity.resolveGated(c.req.raw))) return apiError(c, "unauthenticated");
  const body = (await c.req.raw
    .clone()
    .json()
    .catch(() => null)) as {
    revokeOtherSessions?: unknown;
    currentPassword?: unknown;
    newPassword?: unknown;
  } | null;
  if (body === null || typeof body !== "object" || body.revokeOtherSessions !== undefined)
    return apiError(c, "validationFailed");
  if (typeof body.newPassword === "string" && body.newPassword === body.currentPassword)
    return apiError(c, "validationFailed");
  return d.auth.handler(c.req.raw);
}

type SignOutOutcome = "deleted" | "alreadyGone" | "rowSurvived";

/**
 * The session a sign-out ends (#337): a live one through IdentityService, else an idle-expired
 * one whose row still exists. resolve() refuses an idle-expired session (the idle clock is ours,
 * Better Auth only enforces the absolute limit), but its row and cookie remain, so sign-out still
 * deletes the row and records logout through the same transaction.
 */
async function signOutTarget(
  c: Context<AppEnv>,
  d: AppDeps,
): Promise<{ sessionId: string; actor: AuditActor } | null> {
  const headers = new Headers(c.req.raw.headers);
  headers.set(BACKGROUND_HEADER, "1");
  const p = await d.identity.resolve(new Request(c.req.url, { headers }));
  if (p) return { sessionId: p.sessionId, actor: actorOf(p) };
  const s = await d.auth.api
    .getSession({ headers, query: { disableRefresh: true } })
    .catch(() => null);
  if (!s) return null;
  const [u] = await d.db
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.id, s.user.id));
  if (!u) return null;
  return {
    sessionId: s.session.id,
    actor: { id: u.id, email: auditEmail(u.email), role: u.role as Role },
  };
}

/**
 * #289 (SEC-010, SEC-012): the app, not Better Auth, deletes the session, in one transaction
 * with its logout audit row. requireRequestedWith (http/security.ts) has already refused a
 * header-less sign-out, so Better Auth's origin check no longer has to guard this delete.
 * - One row deleted: logout is recorded in the same transaction; an audit failure rolls the
 *   delete back (500 internal, session and cookie kept, Better Auth never called).
 * - Zero rows and no row left: another sign-out ended it first; answer 200 with no audit row, so
 *   concurrent sign-outs write at most one logout row.
 * - Zero rows but the row is still there (#246, a silently skipped delete): 500, cookie kept.
 * After commit Better Auth's handler clears the cookie; if it fails, the app clears it itself
 * and still answers 200, because the session is gone.
 */
async function signOut(c: Context<AppEnv>, d: AppDeps): Promise<Response> {
  const p = await signOutTarget(c, d);
  if (!p) return d.auth.handler(c.req.raw);
  let outcome: SignOutOutcome;
  try {
    outcome = await withTransaction(d.db, async (tx): Promise<SignOutOutcome> => {
      const gone = await tx
        .delete(session)
        .where(eq(session.id, p.sessionId))
        .returning({ id: session.id });
      if (gone.length === 1) {
        await d.audit.record(tx, {
          type: "logout",
          actor: p.actor,
          identitySource: "local",
          details: { sessionId: p.sessionId },
        });
        return "deleted";
      }
      const left = await tx
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, p.sessionId));
      return left.length > 0 ? "rowSurvived" : "alreadyGone";
    });
  } catch (e) {
    // Fixed text and the error's name only: a query error's message can carry its params.
    d.logger.error("sign-out transaction failed", {
      sessionId: p.sessionId,
      errorName: e instanceof Error ? e.name : typeof e,
    });
    return apiError(c, "internal");
  }
  if (outcome === "rowSurvived") {
    d.logger.error("sign-out left the session row", { sessionId: p.sessionId });
    return apiError(c, "internal");
  }
  if (outcome === "deleted") d.eventBus.endSession(p.sessionId);
  const res = await d.auth.handler(c.req.raw).catch(() => null);
  if (res?.ok) return res;
  d.logger.warn(
    "sign-out: Better Auth failed after the session delete; cookie cleared by the app",
    {
      sessionId: p.sessionId,
      status: res?.status ?? null,
    },
  );
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": clearSessionCookie(d.env),
    },
  });
}
