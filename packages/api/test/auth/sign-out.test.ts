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
  t.request("/api/v1/auth/sign-out", {
    method: "POST",
    headers: { cookie, "x-requested-with": "querymodule" },
  });

// #289 condition 1: a sign-out without the app's X-Requested-With header.
const bareSignOut = (t: TestApp, cookie: string) =>
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

  it("the session delete is ours, so a failing Better Auth handler can no longer leave the session live (#288, #289)", async () => {
    // Updated for #289 (was: 500 and cookie kept): the app deletes the session row in its own
    // transaction before Better Auth runs, so a Better Auth failure (even one that clears the
    // cookie) cannot leave the row behind. The row-survives case is the RAISE(IGNORE) test above.
    const { t, cookie, sessionId, ended } = await signedIn();
    vi.spyOn(t.deps.auth, "handler").mockResolvedValueOnce(
      new Response(null, {
        status: 500,
        headers: { "set-cookie": `${sessionCookieName(t.env)}=; Max-Age=0; Path=/` },
      }),
    );
    const res = await signOut(t, cookie);
    expect(res.status).toBe(200);
    expect(clearsSessionCookie(res, t)).toBe(true);
    expect(await liveSession(t, cookie)).toBeNull();
    const rows = await t.auditRows("logout");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details.sessionId).toBe(sessionId);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("a Better Auth 4xx (origin check) after our delete still answers 200 and clears the cookie (G-M1, #289 condition 3)", async () => {
    // Updated for #289 (was: 403 passed through, cookie kept): the app guard now refuses a
    // forged sign-out before the delete, so a Better Auth refusal can only come after the
    // session row is already gone.
    const { t, cookie, sessionId, ended } = await signedIn();
    vi.spyOn(t.deps.auth, "handler").mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "INVALID_ORIGIN", message: "Invalid origin" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await signOut(t, cookie);
    expect(res.status).toBe(200);
    expect(clearsSessionCookie(res, t)).toBe(true);
    expect(await liveSession(t, cookie)).toBeNull();
    const rows = await t.auditRows("logout");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details.sessionId).toBe(sessionId);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("a Better Auth failure after our delete answers 200 with the cookie cleared, audits one logout and ends the session (G-M2, #289 condition 3)", async () => {
    // Updated for #289 condition 3 (was: 500): the session is gone, so the sign-out succeeded;
    // the app clears the cookie itself when Better Auth's handler fails or throws.
    const { t, cookie, sessionId, ended } = await signedIn();
    vi.spyOn(t.deps.auth, "handler").mockRejectedValueOnce(new Error("better auth down"));
    const res = await signOut(t, cookie);
    expect(res.status).toBe(200);
    expect(clearsSessionCookie(res, t)).toBe(true);
    expect(await liveSession(t, cookie)).toBeNull();
    const rows = await t.auditRows("logout");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details.sessionId).toBe(sessionId);
    expect(ended).toHaveBeenCalledTimes(1);
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

describe("SEC-010 sign-out deletes the session and writes logout in one transaction (#289)", () => {
  it("condition 1: a sign-out without X-Requested-With is refused 403 before anything else; session and cookie kept, no audit", async () => {
    const { t, cookie, sessionId, ended } = await signedIn();
    const handler = vi.spyOn(t.deps.auth, "handler");
    const res = await bareSignOut(t, cookie);
    expect(res.status).toBe(403);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("forbidden");
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
    expect((await liveSession(t, cookie))?.session?.id).toBe(sessionId);
    expect(await t.auditRows("logout")).toHaveLength(0);
    expect(ended).not.toHaveBeenCalled();
  });

  it("condition 1: the guard ignores path case and a trailing slash", async () => {
    const { t, cookie, sessionId } = await signedIn();
    for (const path of ["/api/v1/auth/Sign-Out", "/api/v1/auth/sign-out/"]) {
      const res = await t.request(path, { method: "POST", headers: { cookie } });
      expect(res.status, path).toBe(403);
    }
    expect((await liveSession(t, cookie))?.session?.id).toBe(sessionId);
  });

  it("condition 1: a cross-origin preflight for the header is not granted, so a browser cannot send it", async () => {
    const t = await createTestApp();
    const res = await t.request("/api/v1/auth/sign-out", {
      method: "OPTIONS",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-requested-with",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://attacker.example");
  });

  it("condition 2: an audit failure rolls the delete back; 500 internal, session and cookie kept", async () => {
    const { t, cookie, sessionId, ended } = await signedIn();
    await t.deps.db.$client.execute(
      "CREATE TRIGGER test_audit_down BEFORE INSERT ON audit_event WHEN NEW.type = 'logout' BEGIN SELECT RAISE(ABORT, 'test'); END",
    );
    const handler = vi.spyOn(t.deps.auth, "handler");
    const res = await signOut(t, cookie);
    expect(res.status).toBe(500);
    expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("internal");
    expect(res.headers.getSetCookie()).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
    expect((await liveSession(t, cookie))?.session?.id).toBe(sessionId);
    expect(await t.auditRows("logout")).toHaveLength(0);
    expect(ended).not.toHaveBeenCalled();
    await t.deps.db.$client.execute("DROP TRIGGER test_audit_down");
    expect((await signOut(t, cookie)).status).toBe(200);
    expect(await t.auditRows("logout")).toHaveLength(1);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("condition 2: zero rows deleted (session already gone) answers 200 idempotently with no audit row", async () => {
    const { t, cookie, ended } = await signedIn();
    const resolve = t.deps.identity.resolve.bind(t.deps.identity);
    vi.spyOn(t.deps.identity, "resolve").mockImplementationOnce(async (req) => {
      const p = await resolve(req);
      await t.deps.db.$client.execute("DELETE FROM session");
      return p;
    });
    const res = await signOut(t, cookie);
    expect(res.status).toBe(200);
    expect(clearsSessionCookie(res, t)).toBe(true);
    expect(await t.auditRows("logout")).toHaveLength(0);
    expect(ended).not.toHaveBeenCalled();
  });

  it("condition 4: two parallel sign-outs on one session write at most one logout row", async () => {
    const { t, cookie, sessionId, ended } = await signedIn();
    const [a, b] = await Promise.all([signOut(t, cookie), signOut(t, cookie)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const rows = await t.auditRows("logout");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details.sessionId).toBe(sessionId);
    expect(await liveSession(t, cookie)).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
