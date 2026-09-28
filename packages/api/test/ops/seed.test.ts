import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { derivePassword } from "../../src/seed/password";
import { SeedRefusedError, seedUsers } from "../../src/seed/seed";
import { DEMO_USERS } from "../../src/seed/users";
import { createTestApp } from "../helpers/test-app";

const SECRET = "test-seed-password-secret-0123456789ab";
const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"]);
    return true;
  } catch {
    return false;
  }
})();

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
    expect(changed.map((r) => r.details.role).sort()).toEqual(["admin", "trainingOfficer"]);
  });
  it("refuses a non-empty database", async () => {
    const t = await createTestApp();
    await seedUsers(t.deps, SECRET);
    await expect(seedUsers(t.deps, SECRET)).rejects.toThrow(SeedRefusedError);
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
