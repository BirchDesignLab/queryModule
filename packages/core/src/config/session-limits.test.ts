import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SiteConfigSchema } from "./schema";
import { SESSION_CEILING_MINUTES } from "./session-limits";
import { MINIMAL_LOCALES, minimalSiteConfigInput, TEST_TOKEN_NAMES } from "./test-fixtures";
import { validateSiteConfig } from "./validate";

const en: Record<string, string> = JSON.parse(
  readFileSync(new URL("../../../config/locales/en.json", import.meta.url), "utf8"),
);

function withSession(session?: { absoluteMinutes: number; idleMinutes: number }) {
  const raw = minimalSiteConfigInput();
  raw.auth = session ? { ...raw.auth, session } : {};
  return validateSiteConfig(SiteConfigSchema.parse(raw), MINIMAL_LOCALES, {
    tokenNames: TEST_TOKEN_NAMES,
  });
}

describe("SEC-005 AUD-1 session limits stay under the Better Auth ceiling (spec 4.1, 5.6, D-M2P2-2)", () => {
  it("the ceiling is 7 days", () => {
    expect(SESSION_CEILING_MINUTES).toBe(10_080);
  });

  it("absoluteMinutes above the ceiling is an error at its pointer", () => {
    expect(withSession({ absoluteMinutes: 10_081, idleMinutes: 30 }).errors).toContainEqual({
      level: "error",
      path: "/auth/session/absoluteMinutes",
      key: "config.sessionCeilingExceeded",
      params: { max: 10_080 },
    });
  });

  it("absoluteMinutes at the ceiling passes", () => {
    const keys = withSession({ absoluteMinutes: 10_080, idleMinutes: 30 }).errors.map((e) => e.key);
    expect(keys).not.toContain("config.sessionCeilingExceeded");
    expect(keys).not.toContain("config.sessionIdleOverAbsolute");
  });

  it("idleMinutes above absoluteMinutes is an error at its pointer", () => {
    expect(withSession({ absoluteMinutes: 720, idleMinutes: 721 }).errors).toContainEqual({
      level: "error",
      path: "/auth/session/idleMinutes",
      key: "config.sessionIdleOverAbsolute",
      params: { absoluteMinutes: 720 },
    });
  });

  it("idleMinutes equal to absoluteMinutes passes", () => {
    const keys = withSession({ absoluteMinutes: 720, idleMinutes: 720 }).errors.map((e) => e.key);
    expect(keys).not.toContain("config.sessionIdleOverAbsolute");
  });

  it("the schema defaults (720 and 30) pass both rules", () => {
    const keys = withSession().errors.map((e) => e.key);
    expect(keys).not.toContain("config.sessionCeilingExceeded");
    expect(keys).not.toContain("config.sessionIdleOverAbsolute");
  });

  it("both keys have an en string", () => {
    expect(en["config.sessionCeilingExceeded"]).toBeTruthy();
    expect(en["config.sessionIdleOverAbsolute"]).toBeTruthy();
  });
});
