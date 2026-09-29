import { ApiErrorSchema } from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { sessionCookieName } from "../../src/auth/auth";
import { createTestApp, type TestApp } from "../helpers/test-app";

const PW = "correct-horse-battery-1";
const EMAIL = "dispatcher@example.test";

async function signedIn() {
  const t = await createTestApp();
  await t.createUser(EMAIL, PW);
  const cookie = await t.cookieFor(EMAIL, PW);
  const sessionId = String((await t.auditRows("loginSucceeded"))[0]?.details.sessionId);
  const ended = vi.fn();
  t.deps.eventBus.onSessionEnded(sessionId, ended);
  return { t, cookie, sessionId, ended };
}

const signOut = (t: TestApp, cookie: string) =>
  t.request("/api/v1/auth/sign-out", { method: "POST", headers: { cookie } });

async function liveSession(t: TestApp, cookie: string) {
  const r = await t.request("/api/v1/auth/get-session", { headers: { cookie } });
  return (await r.json()) as { session?: { id: string } } | null;
}

function clearsSessionCookie(res: Response, t: TestApp) {
  const names = [sessionCookieName(t.env), "qm_session", "__Host-qm_session"];
  return res.headers.getSetCookie().some((c) => names.some((n) => c.startsWith(`${n}=`)));
}

describe("SEC-006 sign-out ends the server session or says it did not (#246, spec 5.6)", () => {
  it("a silently skipped session delete answers 500 internal and keeps the cookie, the session and the audit untouched", async () => {
    const { t, cookie, sessionId, ended } = await signedIn();
    await t.deps.db.$client.execute(
      "CREATE TRIGGER test_keep_session BEFORE DELETE ON session BEGIN SELECT RAISE(IGNORE); END",
    );
    const res = await signOut(t, cookie);
    expect(res.status).toBe(500);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("internal");
    expect(clearsSessionCookie(res, t)).toBe(false);
    expect((await liveSession(t, cookie))?.session?.id).toBe(sessionId);
    expect(await t.auditRows("logout")).toHaveLength(0);
    expect(ended).not.toHaveBeenCalled();
    const logged = t.logLines.filter((l) => l.includes("sign-out left the session row"));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(sessionId);
    const token = String(
      (await t.deps.db.$client.execute("SELECT token FROM session")).rows[0]?.token,
    );
    expect(t.logLines.some((l) => l.includes(token))).toBe(false);
  });

  it("a failing session delete answers non-2xx, writes no logout row and leaves the session live", async () => {
    const { t, cookie, sessionId, ended } = await signedIn();
    await t.deps.db.$client.execute(
      "CREATE TRIGGER test_keep_session BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT, 'test'); END",
    );
    const res = await signOut(t, cookie);
    expect(res.ok).toBe(false);
    expect(clearsSessionCookie(res, t)).toBe(false);
    expect(await t.auditRows("logout")).toHaveLength(0);
    expect((await liveSession(t, cookie))?.session?.id).toBe(sessionId);
    expect(ended).not.toHaveBeenCalled();
  });

  it("a failed Better Auth response that clears the cookie while the row survives answers 500 internal and keeps the cookie (#288)", async () => {
    const { t, cookie, sessionId, ended } = await signedIn();
    vi.spyOn(t.deps.auth, "handler").mockResolvedValueOnce(
      new Response(null, {
        status: 500,
        headers: { "set-cookie": `${sessionCookieName(t.env)}=; Max-Age=0; Path=/` },
      }),
    );
    const res = await signOut(t, cookie);
    expect(res.status).toBe(500);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("internal");
    expect(clearsSessionCookie(res, t)).toBe(false);
    expect((await liveSession(t, cookie))?.session?.id).toBe(sessionId);
    expect(await t.auditRows("logout")).toHaveLength(0);
    expect(ended).not.toHaveBeenCalled();
    expect(t.logLines.filter((l) => l.includes("sign-out left the session row"))).toHaveLength(1);
  });

  it("a retry after the fault clears signs out once and audits one logout", async () => {
    const { t, cookie, sessionId, ended } = await signedIn();
    await t.deps.db.$client.execute(
      "CREATE TRIGGER test_keep_session BEFORE DELETE ON session BEGIN SELECT RAISE(IGNORE); END",
    );
    expect((await signOut(t, cookie)).status).toBe(500);
    await t.deps.db.$client.execute("DROP TRIGGER test_keep_session");
    const res = await signOut(t, cookie);
    expect(res.status).toBe(200);
    const rows = await t.auditRows("logout");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details.sessionId).toBe(sessionId);
    expect(await liveSession(t, cookie)).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("a normal sign-out answers 200, clears the cookie, audits logout with the session id and ends the session", async () => {
    const { t, cookie, sessionId, ended } = await signedIn();
    const res = await signOut(t, cookie);
    expect(res.status).toBe(200);
    expect(clearsSessionCookie(res, t)).toBe(true);
    const rows = await t.auditRows("logout");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details.sessionId).toBe(sessionId);
    expect(await liveSession(t, cookie)).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
