import {
  AdminUserListSchema,
  AdminUserSchema,
  AdminUserSessionListSchema,
  CreateUserResponseSchema,
  DisableUserResponseSchema,
  ROUTES,
} from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { adminConfigApp, type Caller, errorOf } from "../helpers/admin-config";
import { startTestServer } from "../helpers/test-app";

/*
 * Task 28 (ADR-0011 item 8, D-A26): user administration. Admin only behind the adminUsers
 * feature; every change writes exactly its audit row in the same transaction (SEC-010); disable
 * revokes sessions and closes their sockets (SEC-005); no password, hash, token or IP value is
 * returned or logged (spec 5.9, SEC-014).
 */

const API = "/api/v1/admin/users";
const PW = "correct-horse-battery-1";
const ORIGIN = "http://localhost:3000";
const UUID = "0198a7c0-0000-7000-8000-000000000000";

async function setup() {
  const a = await adminConfigApp();
  const adminId = await a.userId("admin");
  return { a, adminId };
}
type App = Awaited<ReturnType<typeof setup>>["a"];

/** A plain account made outside the API, so it has no forced password change, plus its cookie. */
async function plainUser(a: App, email: string) {
  const id = await a.t.createUser(email, PW);
  const cookie = await a.t.cookieFor(email, PW);
  return { id, cookie };
}

async function sessionIdOf(a: App, userId: string): Promise<string> {
  const r = await a.t.deps.db.$client.execute({
    sql: "SELECT id FROM session WHERE user_id = ?",
    args: [userId],
  });
  return String(r.rows[0]?.id);
}

/** roleChanged rows from the console only: the setup grants admin through grant-role. */
async function consoleRoleRows(a: App) {
  return (await a.t.auditRows("roleChanged")).filter((r) => r.details.via === "adminConsole");
}

const ROUTE_IDS = [
  "listAdminUsers",
  "createAdminUser",
  "disableAdminUser",
  "setAdminUserRole",
  "listAdminUserSessions",
  "revokeAdminSession",
];

describe("ADR-0011 item 8 admin user routes: access", () => {
  it("every user route in the contract is live", () => {
    const users = ROUTES.filter((r) => ROUTE_IDS.includes(r.id));
    expect(users).toHaveLength(ROUTE_IDS.length);
    for (const r of users) expect(r.status, r.id).toBe("live");
  });

  it("admin only: implementer, trainingOfficer and user 403, anonymous 401, on every route", async () => {
    const { a } = await setup();
    const cases = [
      ["GET", API, undefined],
      ["POST", API, { email: "x@example.test", name: "X", role: "user" }],
      ["POST", `${API}/someone/disable`, undefined],
      ["PUT", `${API}/someone/role`, { role: "user" }],
      ["GET", `${API}/someone/sessions`, undefined],
      ["DELETE", `/api/v1/admin/sessions/${UUID}`, undefined],
    ] as const;
    const who: [Caller, number][] = [
      ["anonymous", 401],
      ["user", 403],
      ["trainingOfficer", 403],
      ["implementer", 403],
    ];
    for (const [method, path, body] of cases)
      for (const [caller, status] of who) {
        const r = await a.call(caller, method, path, body);
        expect(r.status, `${caller} ${method} ${path}`).toBe(status);
      }
  });
});

describe("list users", () => {
  it("lists users with sign-in stats and no secret data", async () => {
    const { a, adminId } = await setup();
    await plainUser(a, "quiet@example.test");
    const r = await a.call("admin", "GET", API);
    expect(r.status).toBe(200);
    const text = await r.text();
    const list = AdminUserListSchema.parse(JSON.parse(text));
    const me = list.users.find((u) => u.id === adminId);
    expect(me).toMatchObject({ role: "admin", disabled: false, mustChangePassword: false });
    expect(me?.signInCount).toBe(1);
    expect(me?.distinctIps).toBe(1);
    expect(me?.lastSignInAt).toBeGreaterThan(0);
    const quiet = list.users.find((u) => u.email === "quiet@example.test");
    expect(quiet?.signInCount).toBe(1);
    expect(text).not.toMatch(/"password"|token|clientIp|hash/i);
  });

  it("reports zero sign-ins and a null last sign-in for an account that never signed in", async () => {
    const { a } = await setup();
    await a.t.createUser("never@example.test", PW);
    const list = AdminUserListSchema.parse(await (await a.call("admin", "GET", API)).json());
    expect(list.users.find((u) => u.email === "never@example.test")).toMatchObject({
      signInCount: 0,
      lastSignInAt: null,
      distinctIps: 0,
    });
  });
});

describe("create user", () => {
  it("returns the one-time password once, writes one userCreated row and logs no password", async () => {
    const { a, adminId } = await setup();
    const r = await a.call("admin", "POST", API, {
      email: "New.Person@Example.test",
      name: "New Person",
      role: "trainingOfficer",
    });
    expect(r.status).toBe(201);
    const body = CreateUserResponseSchema.parse(await r.json());
    const temp = body.temporaryPassword;
    expect(temp.length).toBeGreaterThanOrEqual(16);
    expect(body.user).toMatchObject({
      email: "new.person@example.test",
      name: "New Person",
      role: "trainingOfficer",
      disabled: false,
      mustChangePassword: true,
      signInCount: 0,
    });

    const rows = await a.t.auditRows("userCreated");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: adminId,
      details: { targetUserId: body.user.id, role: "trainingOfficer" },
    });

    expect(a.t.logLines.some((l) => l.includes(temp))).toBe(false);
    const audit = await a.t.deps.db.$client.execute("SELECT details FROM audit_event");
    expect(JSON.stringify(audit.rows).includes(temp)).toBe(false);
    const stored = await a.t.deps.db.$client.execute({
      sql: "SELECT password FROM account WHERE user_id = ?",
      args: [body.user.id],
    });
    expect(String(stored.rows[0]?.password)).not.toContain(temp);
    expect(String(stored.rows[0]?.password).length).toBeGreaterThan(20);

    const list = await (await a.call("admin", "GET", API)).text();
    expect(list.includes(temp)).toBe(false);
    // Two creates never give the same password.
    const again = CreateUserResponseSchema.parse(
      await (
        await a.call("admin", "POST", API, { email: "b@example.test", name: "B", role: "user" })
      ).json(),
    );
    expect(again.temporaryPassword).not.toBe(temp);
  });

  it("answers 400 validationFailed with validation.emailTaken for a taken address, and writes nothing", async () => {
    const { a } = await setup();
    const r = await a.call("admin", "POST", API, {
      email: "ADMIN@example.test",
      name: "Dup",
      role: "user",
    });
    expect(r.status).toBe(400);
    const e = await errorOf(r);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toEqual([{ key: "validation.emailTaken" }]);
    expect(await a.t.auditRows("userCreated")).toHaveLength(0);
  });

  it("answers 400 for a malformed body", async () => {
    const { a } = await setup();
    const r = await a.call("admin", "POST", API, { email: "nope", name: "", role: "root" });
    expect(r.status).toBe(400);
    expect((await errorOf(r)).code).toBe("validationFailed");
  });

  it("rolls the user back when the audit row cannot be written (SEC-010)", async () => {
    const { a } = await setup();
    await a.t.deps.db.$client.execute(
      "CREATE TRIGGER test_no_audit BEFORE INSERT ON audit_event WHEN NEW.type = 'userCreated' BEGIN SELECT RAISE(ABORT, 'test'); END",
    );
    const r = await a.call("admin", "POST", API, {
      email: "ghost@example.test",
      name: "Ghost",
      role: "user",
    });
    expect(r.status).toBe(500);
    const n = await a.t.deps.db.$client.execute(
      "SELECT count(*) AS n FROM user WHERE email = 'ghost@example.test'",
    );
    expect(Number(n.rows[0]?.n)).toBe(0);
    const acc = await a.t.deps.db.$client.execute(
      "SELECT count(*) AS n FROM account WHERE user_id NOT IN (SELECT id FROM user)",
    );
    expect(Number(acc.rows[0]?.n)).toBe(0);
    const accounts = await a.t.deps.db.$client.execute("SELECT count(*) AS n FROM account");
    const users = await a.t.deps.db.$client.execute("SELECT count(*) AS n FROM user");
    expect(Number(accounts.rows[0]?.n)).toBe(Number(users.rows[0]?.n));
  });
});

describe("disable user", () => {
  it("disables in one transaction, deletes sessions, writes one userDisabled row, ends sessions and blocks sign-in", async () => {
    const { a, adminId } = await setup();
    const u = await plainUser(a, "gone@example.test");
    const sessionId = await sessionIdOf(a, u.id);
    const ended = vi.fn();
    a.t.deps.eventBus.onSessionEnded(sessionId, ended);

    const r = await a.call("admin", "POST", `${API}/${u.id}/disable`);
    expect(r.status).toBe(200);
    const body = DisableUserResponseSchema.parse(await r.json());
    expect(body.sessionsRevoked).toBe(1);
    expect(body.user).toMatchObject({ id: u.id, disabled: true });
    expect(ended).toHaveBeenCalledTimes(1);

    const left = await a.t.deps.db.$client.execute({
      sql: "SELECT id FROM session WHERE user_id = ?",
      args: [u.id],
    });
    expect(left.rows).toHaveLength(0);
    const rows = await a.t.auditRows("userDisabled");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: adminId,
      details: {
        targetUserId: u.id,
        sessionsRevoked: 1,
        delegationsRevoked: 0,
        credentialsDeleted: 0,
      },
    });
    expect(await a.t.auditRows("sessionRevoked")).toHaveLength(0);

    const again = await a.t.signIn("gone@example.test", PW);
    expect(again.status).toBe(401);
    const sessions = await a.t.deps.db.$client.execute({
      sql: "SELECT id FROM session WHERE user_id = ?",
      args: [u.id],
    });
    expect(sessions.rows).toHaveLength(0);

    // A second disable is a no-op: nothing to revoke, no second audit row.
    const second = await a.call("admin", "POST", `${API}/${u.id}/disable`);
    expect(second.status).toBe(200);
    expect(DisableUserResponseSchema.parse(await second.json()).sessionsRevoked).toBe(0);
    expect(await a.t.auditRows("userDisabled")).toHaveLength(1);
  });

  it("closes the user's open sockets with 4001", async () => {
    const { a } = await setup();
    const u = await plainUser(a, "socket@example.test");
    const s = await startTestServer(a.t);
    try {
      const ws = await new Promise<WebSocket>((res, rej) => {
        const w = new WebSocket(s.wsUrl, { headers: { origin: ORIGIN, cookie: u.cookie } });
        w.once("open", () => res(w));
        w.once("error", rej);
      });
      const code = new Promise<number>((r) => ws.once("close", (c) => r(c)));
      const r = await a.call("admin", "POST", `${API}/${u.id}/disable`);
      expect(r.status).toBe(200);
      expect(await code).toBe(4001);
    } finally {
      await s.close();
    }
  });

  it("an admin cannot disable themselves (409 lastAdmin) and nothing changes", async () => {
    const { a, adminId } = await setup();
    const r = await a.call("admin", "POST", `${API}/${adminId}/disable`);
    expect(r.status).toBe(409);
    expect((await errorOf(r)).code).toBe("lastAdmin");
    expect(await a.t.auditRows("userDisabled")).toHaveLength(0);
    expect((await a.call("admin", "GET", API)).status).toBe(200);
  });

  it("answers 404 for an unknown user", async () => {
    const { a } = await setup();
    const r = await a.call("admin", "POST", `${API}/nobody/disable`);
    expect(r.status).toBe(404);
    expect((await errorOf(r)).code).toBe("notFound");
  });
});

describe("change role", () => {
  it("grants a role and writes roleChanged via adminConsole", async () => {
    const { a, adminId } = await setup();
    const u = await plainUser(a, "promote@example.test");
    const r = await a.call("admin", "PUT", `${API}/${u.id}/role`, { role: "trainingOfficer" });
    expect(r.status).toBe(200);
    expect(AdminUserSchema.parse(await r.json())).toMatchObject({
      id: u.id,
      role: "trainingOfficer",
    });
    const rows = await consoleRoleRows(a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: adminId,
      details: {
        targetUserId: u.id,
        role: "trainingOfficer",
        change: "granted",
        via: "adminConsole",
      },
    });
  });

  it("a demotion to user is audited as revoked of the held role", async () => {
    const { a } = await setup();
    const u = await plainUser(a, "demote@example.test");
    await a.call("admin", "PUT", `${API}/${u.id}/role`, { role: "implementer" });
    const r = await a.call("admin", "PUT", `${API}/${u.id}/role`, { role: "user" });
    expect(r.status).toBe(200);
    const rows = await consoleRoleRows(a);
    expect(rows.at(-1)?.details).toEqual({
      targetUserId: u.id,
      role: "implementer",
      change: "revoked",
      via: "adminConsole",
    });
  });

  it("the same role is a no-op with no audit row", async () => {
    const { a } = await setup();
    const u = await plainUser(a, "same@example.test");
    const r = await a.call("admin", "PUT", `${API}/${u.id}/role`, { role: "user" });
    expect(r.status).toBe(200);
    expect(await consoleRoleRows(a)).toHaveLength(0);
  });

  it("an admin cannot change their own role (409 lastAdmin)", async () => {
    const { a, adminId } = await setup();
    const r = await a.call("admin", "PUT", `${API}/${adminId}/role`, { role: "user" });
    expect(r.status).toBe(409);
    expect((await errorOf(r)).code).toBe("lastAdmin");
    expect(await consoleRoleRows(a)).toHaveLength(0);
  });

  it("answers 404 for an unknown user and 400 for a bad role", async () => {
    const { a, adminId } = await setup();
    expect((await a.call("admin", "PUT", `${API}/nobody/role`, { role: "user" })).status).toBe(404);
    const bad = await a.call("admin", "PUT", `${API}/${adminId}/role`, { role: "root" });
    expect(bad.status).toBe(400);
  });
});

describe("sessions", () => {
  it("lists a user's live sessions by row id and marks the caller's own, never a token", async () => {
    const { a, adminId } = await setup();
    const u = await plainUser(a, "twice@example.test");
    await a.t.cookieFor("twice@example.test", PW);
    const r = await a.call("admin", "GET", `${API}/${u.id}/sessions`);
    expect(r.status).toBe(200);
    const text = await r.text();
    const list = AdminUserSessionListSchema.parse(JSON.parse(text));
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.every((s) => !s.current)).toBe(true);
    const tokens = await a.t.deps.db.$client.execute("SELECT token FROM session");
    for (const row of tokens.rows) expect(text.includes(String(row.token))).toBe(false);

    const own = AdminUserSessionListSchema.parse(
      await (await a.call("admin", "GET", `${API}/${adminId}/sessions`)).json(),
    );
    expect(own.sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it("lists no sessions past their absolute expiry", async () => {
    const { a } = await setup();
    const u = await plainUser(a, "old@example.test");
    await a.t.deps.db.$client.execute({
      sql: "UPDATE session SET expires_at = 1 WHERE user_id = ?",
      args: [u.id],
    });
    const list = AdminUserSessionListSchema.parse(
      await (await a.call("admin", "GET", `${API}/${u.id}/sessions`)).json(),
    );
    expect(list.sessions).toHaveLength(0);
  });

  it("answers 404 listing sessions of an unknown user", async () => {
    const { a } = await setup();
    expect((await a.call("admin", "GET", `${API}/nobody/sessions`)).status).toBe(404);
  });

  it("revokes one session: row gone, one sessionRevoked admin row, sockets ended", async () => {
    const { a, adminId } = await setup();
    const u = await plainUser(a, "revoked@example.test");
    const sessionId = await sessionIdOf(a, u.id);
    const ended = vi.fn();
    a.t.deps.eventBus.onSessionEnded(sessionId, ended);

    const r = await a.call("admin", "DELETE", `/api/v1/admin/sessions/${sessionId}`);
    expect(r.status).toBe(204);
    expect(ended).toHaveBeenCalledTimes(1);
    const rows = await a.t.auditRows("sessionRevoked");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: adminId,
      details: { sessionId, reason: "admin" },
    });
    const left = await a.t.request("/api/v1/me/preferences", { headers: { cookie: u.cookie } });
    expect(left.status).toBe(401);

    const again = await a.call("admin", "DELETE", `/api/v1/admin/sessions/${sessionId}`);
    expect(again.status).toBe(404);
    expect(await a.t.auditRows("sessionRevoked")).toHaveLength(1);
  });

  it("answers 400 for a malformed session id", async () => {
    const { a } = await setup();
    const r = await a.call("admin", "DELETE", "/api/v1/admin/sessions/not-a-uuid");
    expect(r.status).toBe(400);
  });
});
