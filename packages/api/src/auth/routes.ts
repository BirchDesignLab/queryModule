import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { session, user } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { apiError, rateLimited } from "../http/errors";
import type { AppEnv } from "../http/types";
import { actorOf } from "../seams";
import { BACKGROUND_HEADER } from "./identity";
import { AUTH_LIMITS, clientIp } from "./rate-limit";

type LoginFailReason = "badPassword" | "unknownAccount" | "lockedOut";

export function mountAuthRoutes(app: Hono<AppEnv>, d: AppDeps): void {
  app.all("/api/v1/auth/*", async (c) => {
    if (c.req.path === "/api/v1/auth/embedded" || !d.env.identityModes.includes("standalone"))
      return apiError(c, "notFound");
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
  const body = (await c.req.raw
    .clone()
    .json()
    .catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const key = `login:acct:${email}`;
  const target = email
    ? ((await d.db.select().from(user).where(eq(user.email, email)))[0] ?? null)
    : null;
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
        actor: { id: target.id, email: target.email, role: target.role },
        identitySource: "local",
        details: { method: "password", sessionId: s.id, clientIp: ip },
      }),
    );
    return res;
  }
  if (res.status === 401) {
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
