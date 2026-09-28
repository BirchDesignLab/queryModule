import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { session, user } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { apiError, rateLimited } from "../http/errors";
import type { AppEnv } from "../http/types";
import { actorOf } from "../seams";
import { auditEmail, BACKGROUND_HEADER } from "./identity";
import { AUTH_LIMITS, clientIp } from "./rate-limit";

type LoginFailReason = "badPassword" | "unknownAccount" | "lockedOut";

// The only Better Auth paths this app forwards to (critic:C3): every other Better Auth path
// (revoke-session, revoke-sessions, revoke-other-sessions, change-password, sign-up, ...) would
// end or change a session with no sessionRevoked/logout audit row and no eventBus.endSession,
// breaking spec 5.6/4.7/SEC-010. Add a path here only once it has its own audit and
// eventBus.endSession wiring, like sign-in/email and sign-out below.
const ALLOWED_AUTH_PATHS = new Set([
  "/api/v1/auth/sign-in/email",
  "/api/v1/auth/sign-out",
  "/api/v1/auth/get-session",
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
    .catch(() => null)) as { email?: unknown } | null;
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
  if (res.ok) {
    const token = ((await res.clone().json()) as { token?: string }).token ?? "";
    const s = (
      await d.db.select({ id: session.id }).from(session).where(eq(session.token, token))
    )[0];
    if (!s || !target) throw new Error("sign-in succeeded without a session row");
    await d.limiter.reset(key);
    await withTransaction(d.db, (tx) =>
      d.audit.record(tx, {
        type: "loginSucceeded",
        actor: { id: target.id, email: auditEmail(target.email), role: target.role },
        identitySource: "local",
        details: { method: "password", sessionId: s.id, clientIp: ip },
      }),
    );
    return res;
  }
  if (res.status === 401) {
    // #212 G-M2: only bad credentials count toward the lockout and audit as badPassword or
    // unknownAccount. Any other 401 (for example FAILED_TO_CREATE_SESSION after a correct
    // password) is an internal failure: no lockout increment and no loginFailed row.
    const code = (
      (await res
        .clone()
        .json()
        .catch(() => null)) as { code?: unknown } | null
    )?.code;
    if (code !== "INVALID_EMAIL_OR_PASSWORD") {
      d.logger.error("sign-in failed inside Better Auth", {
        code: typeof code === "string" ? code : "unknown",
      });
      return apiError(c, "internal");
    }
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

async function signOut(c: Context<AppEnv>, d: AppDeps): Promise<Response> {
  const headers = new Headers(c.req.raw.headers);
  headers.set(BACKGROUND_HEADER, "1");
  const p = await d.identity.resolve(new Request(c.req.url, { headers }));
  const res = await d.auth.handler(c.req.raw);
  if (res.ok && p) {
    // #246: Better Auth answers 200 and clears the cookie even when the session row survives
    // (a failed or skipped delete). Fail closed: keep the cookie so a retry can end the session,
    // and write logout / end sockets only for a session that is really gone.
    const left = await d.db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.id, p.sessionId));
    if (left.length > 0) {
      d.logger.error("sign-out left the session row", { sessionId: p.sessionId });
      return apiError(c, "internal");
    }
    await withTransaction(d.db, (tx) =>
      d.audit.record(tx, {
        type: "logout",
        actor: actorOf(p),
        identitySource: "local",
        details: { sessionId: p.sessionId },
      }),
    );
    d.eventBus.endSession(p.sessionId);
  }
  return res;
}
