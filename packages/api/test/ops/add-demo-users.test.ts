import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, userPreference } from "../../src/db/schema";
import {
  AddDemoUsersDomainError,
  AddDemoUsersPartialFailureError,
  addMissingDemoUsers,
  parseAddDemoUsersArgs,
} from "../../src/ops/add-demo-users";
import { grantRole } from "../../src/ops/grant-role";
import { derivePassword } from "../../src/seed/password";
import { DEMO_USERS } from "../../src/seed/users";
import { createTestApp } from "../helpers/test-app";

const SECRET = "test-seed-password-secret-0123456789ab";
const OTHER_PW = "correct-horse-battery-1";

const grantRoleFailure = vi.hoisted(() => ({ failEmail: null as string | null }));
vi.mock("../../src/ops/grant-role", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/ops/grant-role")>();
  return {
    ...actual,
    grantRole: async (...args: Parameters<typeof actual.grantRole>) => {
      if (args[1].email === grantRoleFailure.failEmail)
        throw Object.assign(new Error("injected grantRole failure"), { code: "E_INJECTED" });
      return actual.grantRole(...args);
    },
  };
});

describe("#781 add-demo-users", () => {
  it("creates only the missing demo users and never touches an existing account", async () => {
    const t = await createTestApp();
    // An existing database: two demo accounts made earlier, one with a changed password and role.
    const dispatcherId = await t.createUser("dispatcher@example.test", OTHER_PW);
    const adminId = await t.createUser("admin@example.test", OTHER_PW);
    await grantRole(t.deps, {
      email: "admin@example.test",
      role: "implementer",
      change: "granted",
    });
    const before = (await t.auditRows("roleChanged")).length;

    const out = await addMissingDemoUsers(t.deps, SECRET);

    const missing = DEMO_USERS.filter(
      (u) => u.email !== "dispatcher@example.test" && u.email !== "admin@example.test",
    );
    expect(out.existing).toEqual(["dispatcher@example.test", "admin@example.test"]);
    expect(out.created.map((u) => u.email)).toEqual(missing.map((u) => u.email));
    for (const u of out.created) expect(u.password).toBe(derivePassword(SECRET, u.email));
    // The existing accounts keep their password and role.
    expect((await t.signIn("dispatcher@example.test", OTHER_PW)).status).toBe(200);
    const admin = (await t.deps.db.select().from(user).where(eq(user.id, adminId)))[0];
    expect(admin?.role).toBe("implementer");
    // A new account signs in with its derived password, holds its role and no forced change.
    const a2 = out.created.find((u) => u.email === "admin2@example.test");
    expect((await t.signIn("admin2@example.test", a2?.password ?? "")).status).toBe(200);
    const row = (
      await t.deps.db.select().from(user).where(eq(user.email, "admin2@example.test"))
    )[0];
    expect(row).toMatchObject({ role: "admin", mustChangePassword: false });

    // SEC-010: one userCreated per creation, by the system actor, none for the existing accounts.
    const created = await t.auditRows("userCreated");
    expect(created.map((r) => r.actorUserId)).toEqual(missing.map(() => "system"));
    expect(created.map((r) => r.details.via)).toEqual(missing.map(() => "add-demo-users"));
    const ids = new Set(created.map((r) => r.details.targetUserId));
    expect(ids.has(dispatcherId)).toBe(false);
    expect(ids.has(adminId)).toBe(false);
    for (const r of created) expect(r.details.role).toBe("user");
    // ...and one roleChanged per non-user role granted (grant-role, as the seed writes it).
    const granted = (await t.auditRows("roleChanged")).slice(before);
    expect(granted.map((r) => r.details.role)).toEqual(
      missing.filter((u) => u.role !== "user").map((u) => u.role),
    );
    // No password in any audit row or log line (spec 5.9).
    const all = JSON.stringify([...created, ...granted]) + t.logLines.join("\n");
    for (const u of out.created) expect(all).not.toContain(u.password);
  });

  it("sets the persona of a new officer account", async () => {
    const t = await createTestApp();
    await addMissingDemoUsers(t.deps, SECRET);
    const rows = await t.deps.db
      .select({ email: user.email, personaOverride: userPreference.personaOverride })
      .from(userPreference)
      .innerJoin(user, eq(user.id, userPreference.userId));
    expect(rows.find((r) => r.email === "officer2@example.test")?.personaOverride).toBe(
      "mobileUnit",
    );
  });

  it("a rerun creates nothing and writes no audit row", async () => {
    const t = await createTestApp();
    await addMissingDemoUsers(t.deps, SECRET);
    const n = (await t.auditRows("userCreated")).length + (await t.auditRows("roleChanged")).length;
    const again = await addMissingDemoUsers(t.deps, SECRET);
    expect(again.created).toEqual([]);
    expect(again.existing).toEqual(DEMO_USERS.map((u) => u.email));
    expect(
      (await t.auditRows("userCreated")).length + (await t.auditRows("roleChanged")).length,
    ).toBe(n);
  });

  it("hashes a password only for an account it creates (#782 G-M3)", async () => {
    const t = await createTestApp();
    await addMissingDemoUsers(t.deps, SECRET);
    const ctx = await t.deps.auth.$context;
    const hash = vi.spyOn(ctx.password, "hash");
    try {
      await addMissingDemoUsers(t.deps, SECRET);
      expect(hash).not.toHaveBeenCalled();
    } finally {
      hash.mockRestore();
    }
  });

  it("refuses any account outside @example.test before writing anything", async () => {
    const t = await createTestApp();
    const users = [
      { email: "dispatcher3@example.test", name: "Demo Dispatcher 3", role: "user" as const },
      { email: "someone@example.com", name: "Not Demo", role: "user" as const },
    ];
    await expect(addMissingDemoUsers(t.deps, SECRET, users)).rejects.toThrow(
      AddDemoUsersDomainError,
    );
    expect(await t.deps.db.select().from(user)).toEqual([]);
    expect(await t.auditRows("userCreated")).toEqual([]);
  });

  it("a failed role grant reports the accounts created so far, no password in the message", async () => {
    const t = await createTestApp();
    grantRoleFailure.failEmail = "officer@example.test";
    try {
      const caught = await addMissingDemoUsers(t.deps, SECRET).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(caught).toBeInstanceOf(AddDemoUsersPartialFailureError);
      const err = caught as AddDemoUsersPartialFailureError;
      expect(err.created.map((u) => u.email)).toEqual([
        "dispatcher@example.test",
        "records@example.test",
        "mobileunit@example.test",
        "officer@example.test",
      ]);
      expect(err.message).toContain("officer@example.test");
      // #782 G-M1: the cause is kept, and the message names its class and code only.
      expect((err.cause as Error).message).toBe("injected grantRole failure");
      expect(err.message).toContain("cause: Error E_INJECTED");
      expect(err.message).not.toContain("injected grantRole failure");
      // #782 G-M2: the recovery pointer names the container script and the right anchor.
      expect(err.message).toContain("node scripts/ops/grant-role.js");
      expect(err.message).toContain("docs/demo.md#add-missing-demo-accounts");
      for (const u of err.created) expect(err.message).not.toContain(u.password);
    } finally {
      grantRoleFailure.failEmail = null;
    }
  });

  it("takes no arguments", () => {
    expect(() => parseAddDemoUsersArgs([])).not.toThrow();
    expect(() => parseAddDemoUsersArgs(["admin2@example.test"])).toThrow(/usage/);
  });
});
