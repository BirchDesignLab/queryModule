import { ApiErrorSchema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
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
    const out = await t.request("/api/v1/auth/sign-out", { method: "POST", headers: { cookie } });
    expect(out.status).toBe(200);
    const logoutDetails = (await t.auditRows("logout"))[0]?.details;
    expect(logoutDetails).toEqual({ sessionId: ok?.details.sessionId });
    expect(logoutDetails?.sessionId).not.toBe(token);
  });
  it("auth routes are 404 when IDENTITY_MODES lacks standalone", async () => {
    const t = await createTestApp({ env: { IDENTITY_MODES: "embedded" } });
    expect((await t.signIn(EMAIL, PW)).status).toBe(404);
  });
});
