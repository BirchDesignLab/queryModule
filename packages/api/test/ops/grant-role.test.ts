import { describe, expect, it } from "vitest";
import {
  GrantRoleUsageError,
  grantRole,
  parseGrantRoleArgs,
  ROLES,
  UnknownUserError,
} from "../../src/ops/grant-role";
import { createTestApp } from "../helpers/test-app";

const PW = "correct-horse-battery-1";

describe("SEC-010 grant-role", () => {
  it("grants, audits roleChanged and takes effect on the next request", async () => {
    const t = await createTestApp();
    const id = await t.createUser("officer@example.test", PW);
    const cookie = await t.cookieFor("officer@example.test", PW);
    expect(
      await grantRole(t.deps, {
        email: "Officer@Example.test",
        role: "trainingOfficer",
        change: "granted",
      }),
    ).toEqual({ userId: id, role: "trainingOfficer", changed: true });
    const rows = await t.auditRows("roleChanged");
    expect(rows).toEqual([
      {
        id: rows[0]?.id,
        actorUserId: "system",
        details: {
          targetUserId: id,
          role: "trainingOfficer",
          change: "granted",
          via: "grant-role",
        },
      },
    ]);
    const p = await t.deps.identity.resolve(
      new Request("http://localhost:3000/", { headers: { cookie } }),
    );
    expect(p?.role).toBe("trainingOfficer");
  });
  it("revoke returns the user to the user role", async () => {
    const t = await createTestApp();
    await t.createUser("admin@example.test", PW);
    await grantRole(t.deps, { email: "admin@example.test", role: "admin", change: "granted" });
    expect(
      (await grantRole(t.deps, { email: "admin@example.test", role: "admin", change: "revoked" }))
        .role,
    ).toBe("user");
    expect(await t.auditRows("roleChanged")).toHaveLength(2);
  });
  it("rejects an unknown email, a revoke of a role not held and a grant of user, writing nothing", async () => {
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", PW);
    await grantRole(t.deps, {
      email: "dispatcher@example.test",
      role: "trainingOfficer",
      change: "granted",
    });
    await expect(
      grantRole(t.deps, { email: "nobody@example.test", role: "admin", change: "granted" }),
    ).rejects.toThrow(UnknownUserError);
    await expect(
      grantRole(t.deps, { email: "dispatcher@example.test", role: "admin", change: "revoked" }),
    ).rejects.toThrow(/does not hold/);
    await expect(
      grantRole(t.deps, { email: "dispatcher@example.test", role: "user", change: "granted" }),
    ).rejects.toThrow(/revoke/);
    expect(await t.auditRows("roleChanged")).toHaveLength(1);
    const row = await t.deps.db.$client.execute({
      sql: "SELECT role FROM user WHERE email = ?",
      args: ["dispatcher@example.test"],
    });
    expect(row.rows[0]?.role).toBe("trainingOfficer");
  });
  it("a repeated grant or a revoke of a user-role user changes nothing and audits nothing (#217)", async () => {
    const t = await createTestApp();
    const id = await t.createUser("seed@example.test", PW);
    const o = { email: "seed@example.test", role: "admin", change: "granted" } as const;
    expect(await grantRole(t.deps, o)).toEqual({ userId: id, role: "admin", changed: true });
    expect(await grantRole(t.deps, o)).toEqual({ userId: id, role: "admin", changed: false });
    expect(await t.auditRows("roleChanged")).toHaveLength(1);
    await grantRole(t.deps, { ...o, change: "revoked" });
    expect(await grantRole(t.deps, { ...o, change: "revoked" })).toEqual({
      userId: id,
      role: "user",
      changed: false,
    });
    expect(await t.auditRows("roleChanged")).toHaveLength(2);
  });
  it("stamps updatedAt from the injected clock (#217)", async () => {
    const t = await createTestApp();
    await t.createUser("clock@example.test", PW);
    const tenDays = 10 * 24 * 3600 * 1000;
    t.clock.advance(tenDays);
    await grantRole(t.deps, { email: "clock@example.test", role: "admin", change: "granted" });
    const row = await t.deps.db.$client.execute({
      sql: "SELECT updated_at FROM user WHERE email = ?",
      args: ["clock@example.test"],
    });
    expect(Number(row.rows[0]?.updated_at)).toBeGreaterThan(Date.now() + tenDays - 60_000);
  });
});

describe("SEC-010 grant-role CLI arguments", () => {
  it("parses email, role and --revoke in any position", () => {
    expect(parseGrantRoleArgs(["officer@example.test", "trainingOfficer"])).toEqual({
      email: "officer@example.test",
      role: "trainingOfficer",
      change: "granted",
    });
    expect(parseGrantRoleArgs(["--revoke", "admin@example.test", "admin"])).toEqual({
      email: "admin@example.test",
      role: "admin",
      change: "revoked",
    });
  });
  it("rejects a missing argument, an unknown role, an unknown flag and extra arguments", () => {
    for (const argv of [
      [],
      ["officer@example.test"],
      ["officer@example.test", "superuser"],
      ["officer@example.test", "admin", "--force"],
      ["officer@example.test", "admin", "extra"],
    ]) {
      expect(() => parseGrantRoleArgs(argv)).toThrow(GrantRoleUsageError);
    }
  });
  it("names every role in its usage text, built from ROLES (#339 m1)", () => {
    expect(new GrantRoleUsageError().message).toBe(
      `usage: grant-role <email> <${ROLES.join("|")}> [--revoke]`,
    );
  });
});
