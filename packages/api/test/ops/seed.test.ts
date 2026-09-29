import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { user, userPreference } from "../../src/db/schema";
import { derivePassword } from "../../src/seed/password";
import { SeedPartialFailureError, SeedRefusedError, seedUsers } from "../../src/seed/seed";
import { DEMO_USERS } from "../../src/seed/users";
import { createTestApp } from "../helpers/test-app";

const SECRET = "test-seed-password-secret-0123456789ab";
// Probe the same pipeline the test below spawns (bash running openssl), not openssl alone: on a
// host with openssl on PATH but no bash (or a bash that resolves to a bash without openssl), the
// separate-probe version threw ENOENT instead of skipping (critic:I1).
const hasOpenssl = (() => {
  try {
    execFileSync("bash", ["-c", "openssl version"]);
    return true;
  } catch {
    return false;
  }
})();

// critic:I2 — inject a failure partway through seedUsers's loop (after grantRole is attempted for
// the first non-"user"-role demo account, officer@example.test) so the reported recovery state
// can be asserted. grantRole is mocked because it is seedUsers's only role-changing call.
const grantRoleFailure = vi.hoisted(() => ({ failEmail: null as string | null }));
vi.mock("../../src/ops/grant-role", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/ops/grant-role")>();
  return {
    ...actual,
    grantRole: async (...args: Parameters<typeof actual.grantRole>) => {
      if (args[1].email === grantRoleFailure.failEmail)
        throw new Error("injected grantRole failure");
      return actual.grantRole(...args);
    },
  };
});

describe("SEC-005 seed", () => {
  it("creates every demo user with a derived password and audited roles", async () => {
    const t = await createTestApp();
    const out = await seedUsers(t.deps, SECRET);
    expect(out.map((u) => u.email)).toEqual(DEMO_USERS.map((u) => u.email));
    expect(out.map((u) => u.email)).toContain("smoke@example.test");
    for (const u of out) expect(u.password).toBe(derivePassword(SECRET, u.email));
    const smoke = out.find((u) => u.email === "smoke@example.test");
    expect((await t.signIn("smoke@example.test", smoke?.password ?? "")).status).toBe(200);
    const changed = await t.auditRows("roleChanged");
    expect(changed.map((r) => r.details.role).sort()).toEqual([
      "admin",
      "implementer",
      "trainingOfficer",
    ]);
    // ADR-0011 item 6 (#363): the config-only demo account.
    expect(out.find((u) => u.email === "implementer@example.test")?.role).toBe("implementer");
  });
  it("UX-012 D-A33: the officer demo accounts get the mobileUnit persona, the others none", async () => {
    const t = await createTestApp();
    await seedUsers(t.deps, SECRET);
    const rows = await t.deps.db
      .select({ email: user.email, personaOverride: userPreference.personaOverride })
      .from(userPreference)
      .innerJoin(user, eq(user.id, userPreference.userId));
    expect(rows.sort((a, b) => a.email.localeCompare(b.email))).toEqual([
      { email: "mobileunit@example.test", personaOverride: "mobileUnit" },
      { email: "officer@example.test", personaOverride: "mobileUnit" },
    ]);
  });
  it("#363 M1: every seeded persona is a persona key of the shipped default site", () => {
    const site = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../config/sites/default.json"), "utf8"),
    ) as { personas: { key: string }[] };
    const keys = site.personas.map((p) => p.key);
    for (const u of DEMO_USERS)
      if (u.persona !== undefined) expect(keys, u.email).toContain(u.persona);
  });
  it("#363 M2: a failed preference write reports the users already created, no password", async () => {
    const t = await createTestApp();
    const insert = t.deps.db.insert.bind(t.deps.db);
    const spy = vi.spyOn(t.deps.db, "insert").mockImplementation(((table: unknown) => {
      if (table === userPreference) throw new Error("injected preference failure");
      return insert(table as never);
    }) as typeof t.deps.db.insert);
    try {
      const caught = await seedUsers(t.deps, SECRET).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(caught).toBeInstanceOf(SeedPartialFailureError);
      const err = caught as SeedPartialFailureError;
      expect(err.created.map((u) => u.email)).toEqual([
        "dispatcher@example.test",
        "records@example.test",
        "mobileunit@example.test",
      ]);
      for (const u of err.created) expect(err.message).not.toContain(u.password);
    } finally {
      spy.mockRestore();
    }
  });
  it("refuses a non-empty database", async () => {
    const t = await createTestApp();
    await seedUsers(t.deps, SECRET);
    await expect(seedUsers(t.deps, SECRET)).rejects.toThrow(SeedRefusedError);
  });
  it("reports the demo users already created when a mid-run write fails (critic:I2)", async () => {
    const t = await createTestApp();
    grantRoleFailure.failEmail = "officer@example.test";
    try {
      let caught: unknown;
      try {
        await seedUsers(t.deps, SECRET);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(SeedPartialFailureError);
      const err = caught as SeedPartialFailureError;
      // dispatcher, records, mobileunit (role "user", no grantRole call) plus officer itself: its
      // user row was created before the mocked grantRole threw, so it belongs in the recovery list.
      expect(err.created.map((u) => u.email)).toEqual([
        "dispatcher@example.test",
        "records@example.test",
        "mobileunit@example.test",
        "officer@example.test",
      ]);
      for (const u of err.created) expect(u.password).toBe(derivePassword(SECRET, u.email));
      // The error's own message names the failure but never repeats a password (spec 5.9); only
      // the CLI's stdout is allowed to print them.
      for (const u of err.created) expect(err.message).not.toContain(u.password);
      // A rerun is still refused, per the checker's ruling that the refusal contract never relaxes.
      await expect(seedUsers(t.deps, SECRET)).rejects.toThrow(SeedRefusedError);
    } finally {
      grantRoleFailure.failEmail = null;
    }
  });
  it("derivation is 43 base64url chars and case-insensitive on email", () => {
    expect(derivePassword(SECRET, "Smoke@Example.test")).toBe(
      derivePassword(SECRET, "smoke@example.test"),
    );
    expect(derivePassword(SECRET, "smoke@example.test")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it.runIf(hasOpenssl)("matches the openssl derivation smoke.sh uses", () => {
    const sh = execFileSync("bash", [
      "-c",
      `printf '%s' smoke@example.test | openssl dgst -sha256 -hmac '${SECRET}' -binary | base64 | tr '+/' '-_' | tr -d '='`,
    ])
      .toString()
      .trim();
    expect(sh).toBe(derivePassword(SECRET, "smoke@example.test"));
  });
});
