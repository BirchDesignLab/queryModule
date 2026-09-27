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
});
