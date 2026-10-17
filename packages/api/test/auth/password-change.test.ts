import { resolve } from "node:path";
import { PASSWORD_MIN_LENGTH } from "@querymodule/core/config";
import { CreateUserResponseSchema } from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
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
const FLAGS_OFF = resolve(import.meta.dirname, "../../../config/test/flags-off.json");
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

  it("G-I4: re-setting the temporary password is refused (400) and the flag stays set", async () => {
    const { a, user, temporaryPassword, cookie } = await createdUser();
    const r = await changePassword(a, cookie, {
      currentPassword: temporaryPassword,
      newPassword: temporaryPassword,
    });
    expect(r.status).toBe(400);
    expect((await errorOf(r)).code).toBe("validationFailed");
    const row = await a.t.deps.db.$client.execute({
      sql: "SELECT must_change_password AS m FROM user WHERE id = ?",
      args: [user.id],
    });
    expect(Number(row.rows[0]?.m)).toBe(1);
    expect((await a.t.request("/api/v1/config", { headers: { cookie } })).status).toBe(403);
  });

  it("G-m2: an idle-expired session cannot change the password (401) and the flag stays set", async () => {
    const { a, user, temporaryPassword, cookie } = await createdUser();
    a.t.clock.advance(31 * 60_000);
    const r = await changePassword(a, cookie, {
      currentPassword: temporaryPassword,
      newPassword: NEW_PW,
    });
    expect(r.status).toBe(401);
    expect((await errorOf(r)).code).toBe("unauthenticated");
    const row = await a.t.deps.db.$client.execute({
      sql: "SELECT must_change_password AS m FROM user WHERE id = ?",
      args: [user.id],
    });
    expect(Number(row.rows[0]?.m)).toBe(1);
  });

  it("G-m1/C-m3: a flagged user gets 404 from a feature-off admin route, like every caller", async () => {
    const a = await adminConfigApp({ siteConfig: FLAGS_OFF });
    const id = await a.t.createUser("flagged@example.test", "correct-horse-battery-1");
    await a.t.deps.db.$client.execute({
      sql: "UPDATE user SET must_change_password = 1 WHERE id = ?",
      args: [id],
    });
    const cookie = await a.t.cookieFor("flagged@example.test", "correct-horse-battery-1");
    for (const path of ["/api/v1/admin/users", "/api/v1/admin/config"]) {
      const r = await a.t.request(path, { headers: { cookie } });
      expect(r.status, path).toBe(404);
      expect((await errorOf(r)).code).toBe("notFound");
    }
  });

  it("#505 N-m1: adminGuard gates the forced change and resolves the session once per admin request", async () => {
    const { a, cookie } = await createdUser();
    const gated = vi.spyOn(a.t.deps.identity, "resolveGated");
    const plain = vi.spyOn(a.t.deps.identity, "resolve");
    for (const path of ["/api/v1/admin/config", "/api/v1/admin/users"]) {
      gated.mockClear();
      plain.mockClear();
      expect((await a.call("admin", "GET", path)).status, path).toBe(200);
      expect(gated.mock.calls.length + plain.mock.calls.length, path).toBe(1);
      const r = await a.t.request(path, { headers: { cookie } });
      expect(r.status, path).toBe(403);
      expect((await errorOf(r)).code).toBe("passwordChangeRequired");
    }
  });

  it("an ordinary user (flag false) is not gated", async () => {
    const a = await adminConfigApp();
    const r = await a.call("admin", "GET", "/api/v1/config");
    expect(r.status).toBe(200);
  });
});

describe("SEC-010 passwordChanged audit (#523, spec 4.7, 5.6)", () => {
  const flagOf = async (a: Awaited<ReturnType<typeof createdUser>>["a"], id: string) =>
    Number(
      (
        await a.t.deps.db.$client.execute({
          sql: "SELECT must_change_password AS m FROM user WHERE id = ?",
          args: [id],
        })
      ).rows[0]?.m,
    );
  const auditText = async (a: Awaited<ReturnType<typeof createdUser>>["a"]) =>
    (await a.t.deps.db.$client.execute("SELECT details FROM audit_event")).rows
      .map((r) => String(r.details))
      .join(" ");

  it("a self change writes one passwordChanged row by the user, and the cleared flag agrees", async () => {
    const { a, user, temporaryPassword, cookie } = await createdUser();
    const r = await changePassword(a, cookie, {
      currentPassword: temporaryPassword,
      newPassword: NEW_PW,
    });
    expect(r.status).toBe(200);
    const rows = await a.t.auditRows("passwordChanged");
    expect(rows).toEqual([
      { id: rows[0]?.id, actorUserId: user.id, details: { targetUserId: user.id, via: "self" } },
    ]);
    expect(await flagOf(a, user.id)).toBe(0);
    const text = `${a.t.logLines.join(" ")} ${await auditText(a)}`;
    expect(text.includes(NEW_PW) || text.includes(temporaryPassword)).toBe(false);
  });

  it("a failed change (wrong current password) writes no row and keeps the flag", async () => {
    const { a, user, cookie } = await createdUser();
    const r = await changePassword(a, cookie, {
      currentPassword: "not-the-temporary-password",
      newPassword: NEW_PW,
    });
    expect(r.ok).toBe(false);
    expect(await a.t.auditRows("passwordChanged")).toHaveLength(0);
    expect(await flagOf(a, user.id)).toBe(1);
  });

  it("#690: an audit write failure rolls the change back: old password works, flag set, ids-only log", async () => {
    const { a, user, temporaryPassword, cookie } = await createdUser();
    const record = a.t.deps.audit.record.bind(a.t.deps.audit);
    vi.spyOn(a.t.deps.audit, "record").mockImplementation((tx, e) =>
      e.type === "passwordChanged" ? Promise.reject(new Error("audit down")) : record(tx, e),
    );
    const r = await changePassword(a, cookie, {
      currentPassword: temporaryPassword,
      newPassword: NEW_PW,
    });
    expect(r.status).toBe(500);
    expect((await errorOf(r)).code).toBe("internal");
    expect(await a.t.auditRows("passwordChanged")).toHaveLength(0);
    // One transaction: the password, the flag and the row commit together or not at all.
    expect(await flagOf(a, user.id)).toBe(1);
    expect((await a.t.signIn("fresh@example.test", NEW_PW)).status).toBe(401);
    expect((await a.t.signIn("fresh@example.test", temporaryPassword)).status).toBe(200);
    // Nothing changed, so the session stays (still gated by the forced change).
    expect((await a.t.request("/api/v1/config", { headers: { cookie } })).status).toBe(403);
    const failed = a.t.logLines.filter((l) => l.includes("password change failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain(user.id);
    const text = `${a.t.logLines.join(" ")} ${await auditText(a)}`;
    expect(text.includes(NEW_PW) || text.includes(temporaryPassword)).toBe(false);
  });

  it("#690: a success writes exactly one row, and the new hash is one Better Auth's sign-in accepts", async () => {
    const { a, user, temporaryPassword, cookie } = await createdUser();
    const r = await changePassword(a, cookie, {
      currentPassword: temporaryPassword,
      newPassword: NEW_PW,
    });
    expect(r.status).toBe(200);
    expect(await a.t.auditRows("passwordChanged")).toHaveLength(1);
    expect(await flagOf(a, user.id)).toBe(0);
    expect((await a.t.signIn("fresh@example.test", NEW_PW)).status).toBe(200);
  });

  it("#690: refusals keep Better Auth's codes the client reads, and change nothing", async () => {
    const { a, user, temporaryPassword, cookie } = await createdUser();
    const cases: [Record<string, unknown>, string][] = [
      [{ currentPassword: "not-the-temporary-password", newPassword: NEW_PW }, "INVALID_PASSWORD"],
      [{ currentPassword: temporaryPassword, newPassword: "short" }, "PASSWORD_TOO_SHORT"],
      [{ currentPassword: temporaryPassword, newPassword: "x".repeat(129) }, "PASSWORD_TOO_LONG"],
    ];
    for (const [body, code] of cases) {
      const r = await changePassword(a, cookie, body);
      expect(r.status, code).toBe(400);
      expect(((await r.json()) as { code?: string }).code, code).toBe(code);
    }
    for (const bad of [{ newPassword: NEW_PW }, { currentPassword: 1, newPassword: NEW_PW }]) {
      const r = await changePassword(a, cookie, bad);
      expect(r.status).toBe(400);
      expect((await errorOf(r)).code).toBe("validationFailed");
    }
    expect(await a.t.auditRows("passwordChanged")).toHaveLength(0);
    expect(await flagOf(a, user.id)).toBe(1);
    expect((await a.t.signIn("fresh@example.test", temporaryPassword)).status).toBe(200);
  });

  it("#690 pin: Better Auth still exposes $context.password and the credential account shape", async () => {
    const { a, user, temporaryPassword } = await createdUser();
    const ctx = await a.t.deps.auth.$context;
    expect(typeof ctx.password.hash).toBe("function");
    expect(typeof ctx.password.verify).toBe("function");
    expect(ctx.password.config.minPasswordLength).toBe(PASSWORD_MIN_LENGTH);
    expect(ctx.password.config.maxPasswordLength).toBe(128);
    const rows = await a.t.deps.db.$client.execute({
      sql: "SELECT provider_id AS p, password AS h FROM account WHERE user_id = ?",
      args: [user.id],
    });
    expect(rows.rows.map((r) => r.p)).toEqual(["credential"]);
    const hash = String(rows.rows[0]?.h);
    expect(await ctx.password.verify({ hash, password: temporaryPassword })).toBe(true);
    expect(
      await ctx.password.verify({ hash: await ctx.password.hash(NEW_PW), password: NEW_PW }),
    ).toBe(true);
  });

  it("#690: no other Better Auth route can set a password around this one", async () => {
    const { a, cookie } = await createdUser();
    for (const path of ["set-password", "reset-password", "update-user", "change-email"]) {
      const r = await a.t.request(`/api/v1/auth/${path}`, {
        method: "POST",
        headers: { ...H, cookie },
        body: JSON.stringify({ newPassword: NEW_PW, token: "x" }),
      });
      expect(r.status, path).toBe(404);
    }
  });
});
