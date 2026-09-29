import { ApiErrorSchema } from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { sessionCookieName } from "../../src/auth/auth";
import { createTestApp } from "../helpers/test-app";

const MIN = 60_000;
const PW = "correct-horse-battery-1";
const EMAIL = "dispatcher@example.test";

describe("SEC-005 auth limits and lockout", () => {
  it("[M0] 10 failures lock the account 15 min; the lockout is audited", async () => {
    const t = await createTestApp();
    const id = await t.createUser(EMAIL, PW);
    for (let i = 0; i < 10; i++)
      expect((await t.signIn(EMAIL, "wrong-password-000")).status).toBe(401);
    const failed = await t.auditRows("loginFailed");
    expect(failed).toHaveLength(10);
    expect(failed[9]?.details).toMatchObject({ targetUserId: id, reason: "badPassword" });
    expect(typeof failed[9]?.details.lockoutUntil).toBe("number");
    expect(failed[8]?.details).not.toHaveProperty("lockoutUntil");
    const locked = await t.signIn(EMAIL, PW);
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).not.toBeNull();
    expect(ApiErrorSchema.parse(await locked.json()).error.code).toBe("rateLimited");
    expect((await t.auditRows("loginFailed")).at(-1)?.details).toMatchObject({
      reason: "lockedOut",
    });
    t.clock.advance(15 * MIN + 1);
    expect((await t.signIn(EMAIL, PW)).status).toBe(200);
    expect(await t.auditRows("loginSucceeded")).toHaveLength(1);
  });
  it("Task 16 carry-forward: a mixed-case email counts toward the same account lockout", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    for (let i = 0; i < 9; i++)
      expect((await t.signIn(EMAIL, "wrong-password-000")).status).toBe(401);
    const mixedCase = "Dispatcher@Example.TEST";
    expect((await t.signIn(mixedCase, "wrong-password-000")).status).toBe(401);
    const locked = await t.signIn(mixedCase, PW);
    expect(locked.status).toBe(429);
    expect((await t.auditRows("loginFailed")).at(-1)?.details).toMatchObject({
      reason: "lockedOut",
    });
  });
  it("unknown accounts lock the same way (no enumeration)", async () => {
    const t = await createTestApp();
    for (let i = 0; i < 10; i++) await t.signIn("nobody@example.test", "wrong-password-000");
    expect((await t.signIn("nobody@example.test", "wrong-password-000")).status).toBe(429);
    expect((await t.auditRows("loginFailed"))[0]?.details).toMatchObject({
      targetUserId: null,
      reason: "unknownAccount",
    });
  });
  it("100 auth requests per 15 min per CF-Connecting-IP", async () => {
    const t = await createTestApp({ env: { NODE_ENV: "production" } });
    const ip = { "cf-connecting-ip": "203.0.113.7" };
    for (let i = 0; i < 100; i++) await t.signIn(`u${i}@example.test`, "wrong-password-000", ip);
    expect((await t.signIn("u100@example.test", "wrong-password-000", ip)).status).toBe(429);
    expect(
      (
        await t.signIn("u101@example.test", "wrong-password-000", {
          "cf-connecting-ip": "198.51.100.4",
        })
      ).status,
    ).toBe(401);
  }, 60_000);
  it("limiter state survives a restart", async () => {
    const a = await createTestApp();
    await a.createUser(EMAIL, PW);
    for (let i = 0; i < 10; i++) await a.signIn(EMAIL, "wrong-password-000");
    a.deps.db.$client.close();
    const b = await createTestApp({ env: { DATA_DIR: a.env.dataDir }, clock: a.clock });
    expect((await b.signIn(EMAIL, PW)).status).toBe(429);
  });
  it("login and logout are audited with the session id", async () => {
    const t = await createTestApp();
    const id = await t.createUser(EMAIL, PW);
    const signInRes = await t.signIn(EMAIL, PW);
    const token = ((await signInRes.clone().json()) as { token?: string }).token;
    const cookie = signInRes.headers
      .getSetCookie()
      .find((s) => s.startsWith(`${sessionCookieName(t.env)}=`))
      ?.split(";")[0];
    if (!cookie) throw new Error("sign-in did not set a session cookie");
    const ok = (await t.auditRows("loginSucceeded"))[0];
    expect(ok).toMatchObject({
      actorUserId: id,
      details: { method: "password", clientIp: "local" },
    });
    // Carry-forward #104 C-M2: the audited sessionId is the session row id, never the token.
    expect(ok?.details.sessionId).not.toBe(token);
    const out = await t.request("/api/v1/auth/sign-out", {
      method: "POST",
      headers: { cookie, "x-requested-with": "querymodule" },
    });
    expect(out.status).toBe(200);
    const logoutDetails = (await t.auditRows("logout"))[0]?.details;
    expect(logoutDetails).toEqual({ sessionId: ok?.details.sessionId });
    expect(logoutDetails?.sessionId).not.toBe(token);
  });
  it("auth routes are 404 when IDENTITY_MODES lacks standalone", async () => {
    const t = await createTestApp({ env: { IDENTITY_MODES: "embedded" } });
    expect((await t.signIn(EMAIL, PW)).status).toBe(404);
  });
  it("critic:C1 rejects a non-JSON sign-in body before any lookup, even on a locked account", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    for (let i = 0; i < 10; i++)
      expect((await t.signIn(EMAIL, "wrong-password-000")).status).toBe(401);
    expect((await t.signIn(EMAIL, PW)).status).toBe(429); // account is now locked
    const succeededBefore = await t.auditRows("loginSucceeded");
    const formBody = `email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PW)}`;
    const r = await t.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody,
    });
    expect(r.status).toBe(400);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("validationFailed");
    expect(await t.auditRows("loginSucceeded")).toEqual(succeededBefore);
    const sessionCount = (await t.deps.db.$client.execute("SELECT count(*) as n FROM session"))
      .rows[0];
    expect(Number(sessionCount?.n)).toBe(0);
  });
  it("critic:C1 a form-encoded sign-in is 400 validationFailed, never reaches Better Auth and leaves the lockout counter alone", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    const r = await t.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PW)}`,
    });
    expect(r.status).toBe(400);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("validationFailed");
    expect(await t.auditRows("loginSucceeded")).toHaveLength(0);
    expect(await t.auditRows("loginFailed")).toHaveLength(0);
    const sessions = (await t.deps.db.$client.execute("SELECT count(*) as n FROM session")).rows[0];
    expect(Number(sessions?.n)).toBe(0);
    const acct = await t.deps.db.$client.execute({
      sql: "SELECT count(*) as n FROM rate_limit WHERE key = ?",
      args: [`login:acct:${EMAIL}`],
    });
    expect(Number(acct.rows[0]?.n)).toBe(0);
  });
  it("critic:C1 rejects a JSON sign-in body with no email, without reaching the handler", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    const r = await t.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: PW }),
    });
    expect(r.status).toBe(400);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("validationFailed");
    expect(await t.auditRows("loginFailed")).toHaveLength(0);
  });
  it("critic:C3 returns 404 for Better Auth session-revocation and password-change paths", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    const cookie = await t.cookieFor(EMAIL, PW);
    for (const path of [
      "/api/v1/auth/revoke-session",
      "/api/v1/auth/revoke-sessions",
      "/api/v1/auth/revoke-other-sessions",
      "/api/v1/auth/change-password",
    ]) {
      const r = await t.request(path, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(r.status, path).toBe(404);
    }
  });
});

describe("SEC-005 session limits over HTTP", () => {
  it("idle 30 min expires; activity refreshes; X-Background does not", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    const cookie = await t.cookieFor(EMAIL, PW);
    t.clock.advance(20 * MIN);
    expect((await t.request("/api/v1/config", { headers: { cookie } })).status).toBe(200);
    t.clock.advance(20 * MIN);
    expect(
      (await t.request("/api/v1/config", { headers: { cookie, "x-background": "1" } })).status,
    ).toBe(200);
    t.clock.advance(11 * MIN);
    expect((await t.request("/api/v1/config", { headers: { cookie } })).status).toBe(401);
  });
  it("absolute 12 h expires despite activity", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    const cookie = await t.cookieFor(EMAIL, PW);
    for (let i = 0; i < 24; i++) {
      t.clock.advance(29 * MIN);
      expect((await t.request("/api/v1/config", { headers: { cookie } })).status).toBe(200);
    }
    t.clock.advance(25 * MIN);
    expect((await t.request("/api/v1/config", { headers: { cookie } })).status).toBe(401);
  });
  it("#212 G-M2: a Better Auth 401 other than bad credentials is an internal error, not a counted failure", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    vi.spyOn(t.deps.auth, "handler").mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "FAILED_TO_CREATE_SESSION", message: "x" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await t.signIn(EMAIL, PW);
    expect(r.status).toBe(500);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("internal");
    expect(await t.auditRows("loginFailed")).toHaveLength(0);
    const acct = await t.deps.db.$client.execute({
      sql: "SELECT count(*) as n FROM rate_limit WHERE key = ?",
      args: [`login:acct:${EMAIL}`],
    });
    expect(Number(acct.rows[0]?.n)).toBe(0);
    // A real bad password is still counted and audited.
    expect((await t.signIn(EMAIL, "wrong-password-000")).status).toBe(401);
    expect((await t.auditRows("loginFailed"))[0]?.details).toMatchObject({ reason: "badPassword" });
  });
  it("#212 G-M1: loginSucceeded audits a null email when the address fails the audit actor schema", async () => {
    const t = await createTestApp();
    const label = "b".repeat(60);
    const long = `${"a".repeat(64)}@${label}.${label}.${label}.example.test`;
    expect(long.length).toBeGreaterThan(254);
    const id = await t.createUser(long, PW);
    expect((await t.signIn(long, PW)).status).toBe(200);
    const rows = await t.deps.db.$client.execute({
      sql: "SELECT actor_email FROM audit_event WHERE type = 'loginSucceeded' AND actor_user_id = ?",
      args: [id],
    });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.actor_email).toBeNull();
  });
});
