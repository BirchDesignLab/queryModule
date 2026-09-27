import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deniedGlobals, findGlobalMemberAccess, scanCore } from "./core-purity";

// #85 item 1: biome's noRestrictedGlobals (#71) matches bare identifiers only, so
// globalThis.fetch or window.localStorage in packages/core/src lint clean. This
// scan closes the gap; its name list is biome.json's deniedGlobals.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("core purity: IO globals through a global object (#85)", () => {
  const names = deniedGlobals(readFileSync(resolve(root, "biome.json"), "utf8"));

  it("reads the denied names from biome.json", () => {
    expect(names).toEqual(expect.arrayContaining(["fetch", "localStorage", "navigator"]));
  });

  it("flags member access through globalThis, window, self or global", () => {
    for (const src of [
      "globalThis.fetch(url)",
      "const s = window.localStorage;",
      "self?.navigator.onLine",
      'globalThis["indexedDB"]',
      "global . process.env",
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  it("ignores other members, bare words in strings, and unrelated objects", () => {
    for (const src of ["globalThis.structuredClone(x)", "api.fetch()", "myWindow.localStorage"])
      expect(findGlobalMemberAccess(src, names), src).toEqual([]);
  });

  it("packages/core/src (tests excluded) has no such access", () => {
    expect(scanCore(root, names)).toEqual([]);
  });
});
