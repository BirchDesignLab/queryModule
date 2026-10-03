import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";

// #311 Task 13: the boot-smoke helper runs standalone in the image, so it cannot import
// SYSTEM_ACTOR. It names the system actor once, and this test keeps that copy in step.
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "smoke-request-key.mjs"),
  "utf8",
);

describe("smoke-request-key.mjs system actor", () => {
  it("names the system actor once, in step with SYSTEM_ACTOR", () => {
    const m =
      /const SYSTEM_ACTOR = \{ id: "([^"]*)", role: "([^"]*)", identitySource: "([^"]*)" \};/.exec(
        source,
      );
    expect(m).not.toBeNull();
    expect([m?.[1], m?.[2]]).toEqual([SYSTEM_ACTOR.id, SYSTEM_ACTOR.role]);
    expect(m?.[3]).toBe("system");
  });
  it("has no other hardcoded system actor strings", () => {
    expect(source.match(/"system"/g)).toHaveLength(3);
  });
});
