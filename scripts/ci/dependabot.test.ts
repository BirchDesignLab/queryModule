import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface Update {
  "package-ecosystem": string;
  ignore?: { "dependency-name": string; versions?: string[]; "update-types"?: string[] }[];
}
const config = parse(
  readFileSync(resolve(import.meta.dirname, "../../.github/dependabot.yml"), "utf8"),
) as { updates: Update[] };

describe("dependabot (ADR-0001, #96 G-M6)", () => {
  it("never proposes @types/node above the Node 24 runtime", () => {
    const npm = config.updates.find((u) => u["package-ecosystem"] === "npm");
    const rule = npm?.ignore?.find((i) => i["dependency-name"] === "@types/node");
    expect(rule?.versions).toEqual([">=25"]);
  });

  it("holds Expo-pinned packages to patch updates (PR #186, Expo SDK 57)", () => {
    const npm = config.updates.find((u) => u["package-ecosystem"] === "npm");
    for (const name of ["react-native", "react", "react-dom", "@types/react"]) {
      const rule = npm?.ignore?.find((i) => i["dependency-name"] === name);
      expect(rule?.["update-types"], name).toEqual([
        "version-update:semver-minor",
        "version-update:semver-major",
      ]);
    }
  });
});
