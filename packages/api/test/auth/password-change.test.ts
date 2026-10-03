import { CreateUserResponseSchema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { adminConfigApp, errorOf } from "../helpers/admin-config";
import { startTestServer } from "../helpers/test-app";

/*
 * Task 28 (D-A26, developer ruling 10-03-26): an admin-created user must change the temporary
 * password before any non-auth route. While user.must_change_password is true every
 * /api/v1 data route and the WebSocket upgrade answer 403 passwordChangeRequired; Better Auth's
 * own sign-in, sign-out, get-session and change-password stay open.
 */

const NEW_PW = "a-brand-new-password-9";
const ORIGIN = "http://localhost:3000";
const H = { "x-requested-with": "querymodule", "content-type": "application/json" };

async function createdUser() {
  const a = await adminConfigApp();
  const r = await a.call("admin", "POST", "/api/v1/admin/users", {
    email: "fresh@example.test",
    name: "Fresh",
    role: "user",
  });
  const { user, temporaryPassword } = CreateUserResponseSchema.parse(await r.json());
  const cookie = await a.t.cookieFor("fresh@example.test", temporaryPassword);
  return { a, user, temporaryPassword, cookie };
}

const changePassword = (
  a: Awaited<ReturnType<typeof createdUser>>["a"],
  cookie: string,
  body: Record<string, unknown>,
) =>
  a.t.request("/api/v1/auth/change-password", {
    method: "POST",
    headers: { ...H, cookie },
    body: JSON.stringify(body),
  });

describe("forced password change (D-A26)", () => {
  it("signs in with the temporary password but every data route answers 403 passwordChangeRequired", async () => {
    const { a, cookie } = await createdUser();
    for (const path of ["/api/v1/config", "/api/v1/me/preferences", "/api/v1/admin/config"]) {
      const r = await a.t.request(path, { headers: { cookie } });
      expect(r.status, path).toBe(403);
      expect((await errorOf(r)).code).toBe("passwordChangeRequired");
    }
    const q = await a.t.request("/api/v1/queries", {
      method: "POST",
      headers: { ...H, cookie },
      body: "{}",
    });
    expect(q.status).toBe(403);
    expect((await errorOf(q)).code).toBe("passwordChangeRequired");
    const s = await a.t.request("/api/v1/auth/get-session", { headers: { cookie } });
    expect(s.status).toBe(200);
  });

  it("refuses the WebSocket upgrade with 403", async () => {
    const { a, cookie } = await createdUser();
    const s = await startTestServer(a.t);
    try {
      await expect(
        new Promise((res, rej) => {
          const w = new WebSocket(s.wsUrl, { headers: { origin: ORIGIN, cookie } });
          w.once("open", () => res(w));
          w.once("unexpected-response", (_q, r) => rej(new Error(`HTTP ${r.statusCode}`)));
          w.once("error", rej);
        }),
      ).rejects.toThrow("HTTP 403");
    } finally {
      await s.close();
    }
  });

  it("change-password clears the flag and the data routes then answer 200", async () => {
    const { a, user, temporaryPassword, cookie } = await createdUser();
    const r = await changePassword(a, cookie, {
      currentPassword: temporaryPassword,
      newPassword: NEW_PW,
    });
    expect(r.status).toBe(200);
    const row = await a.t.deps.db.$client.execute({
      sql: "SELECT must_change_password AS m FROM user WHERE id = ?",
      args: [user.id],
    });
    expect(Number(row.rows[0]?.m)).toBe(0);
    const ok = await a.t.request("/api/v1/config", { headers: { cookie } });
    expect(ok.status).toBe(200);
    // The old password no longer signs in; the new one does.
    expect((await a.t.signIn("fresh@example.test", temporaryPassword)).status).toBe(401);
    expect((await a.t.signIn("fresh@example.test", NEW_PW)).status).toBe(200);
    expect(a.t.logLines.some((l) => l.includes(NEW_PW) || l.includes(temporaryPassword))).toBe(
      false,
    );
  });

  it("a failed change-password (wrong current password) keeps the flag", async () => {
    const { a, user, cookie } = await createdUser();
    const r = await changePassword(a, cookie, {
      currentPassword: "not-the-temporary-password",
      newPassword: NEW_PW,
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    const row = await a.t.deps.db.$client.execute({
      sql: "SELECT must_change_password AS m FROM user WHERE id = ?",
      args: [user.id],
    });
    expect(Number(row.rows[0]?.m)).toBe(1);
    expect((await a.t.request("/api/v1/config", { headers: { cookie } })).status).toBe(403);
  });

  it("change-password refuses revokeOtherSessions, which would end sessions with no audit row", async () => {
    const { a, temporaryPassword, cookie } = await createdUser();
    const r = await changePassword(a, cookie, {
      currentPassword: temporaryPassword,
      newPassword: NEW_PW,
      revokeOtherSessions: true,
    });
    expect(r.status).toBe(400);
    expect((await errorOf(r)).code).toBe("validationFailed");
  });

  it("change-password needs a session and X-Requested-With", async () => {
    const { a, temporaryPassword, cookie } = await createdUser();
    const bare = await a.t.request("/api/v1/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: NEW_PW }),
    });
    expect(bare.status).toBe(403);
    const anon = await a.t.request("/api/v1/auth/change-password", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: NEW_PW }),
    });
    expect(anon.status).toBe(401);
  });

  it("an ordinary user (flag false) is not gated", async () => {
    const a = await adminConfigApp();
    const r = await a.call("admin", "GET", "/api/v1/config");
    expect(r.status).toBe(200);
  });
});
