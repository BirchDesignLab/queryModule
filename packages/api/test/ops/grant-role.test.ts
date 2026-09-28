import { describe, expect, it } from "vitest";
import { grantRole, UnknownUserError } from "../../src/ops/grant-role";
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
    ).toEqual({ userId: id, role: "trainingOfficer" });
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
  it("rejects an unknown email and a revoke of a role not held, writing nothing", async () => {
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", PW);
    await expect(
      grantRole(t.deps, { email: "nobody@example.test", role: "admin", change: "granted" }),
    ).rejects.toThrow(UnknownUserError);
    await expect(
      grantRole(t.deps, { email: "dispatcher@example.test", role: "admin", change: "revoked" }),
    ).rejects.toThrow(/does not hold/);
    expect(await t.auditRows("roleChanged")).toHaveLength(0);
  });
});
