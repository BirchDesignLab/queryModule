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

  it("ignores destructuring of non-denied names only", () => {
    expect(findGlobalMemberAccess("const { Math } = globalThis;", names)).toEqual([]);
  });

  it("packages/core/src (tests excluded) has no such access", () => {
    expect(scanCore(root, names)).toEqual([]);
  });

  // Developer ruling 09-27-26 (#96 G-M5): destructuring, chained globals, one-level aliases.
  it("flags destructuring from a global object", () => {
    for (const src of [
      "const { fetch } = globalThis;",
      "let { localStorage: f } = window;",
      "var { a, fetch } = self;",
      "const {\n  fetch,\n  navigator\n} = global;",
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  it("flags chained global objects", () => {
    for (const src of [
      "globalThis.window.fetch(url)",
      "globalThis.self.localStorage",
      "window.globalThis.fetch",
      'globalThis["window"].fetch',
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  it("flags one-level aliases of a global object", () => {
    for (const src of [
      "const g = globalThis;\ng.fetch(url);",
      "const w = window;\nw?.localStorage;",
      'const g = globalThis;\ng["fetch"]();',
      "const g = globalThis;\nconst { fetch } = g;",
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  it("does not track deeper aliases (documented out of scope)", () => {
    for (const src of [
      // alias of an alias
      "const g = globalThis;\nconst g2 = g;\ng2.fetch(url);",
      // alias passed through a function
      "const g = globalThis;\nfunction use(x) { x.fetch(url); }\nuse(g);",
      // reassignment
      "let g = 1;\ng = globalThis;\ng.fetch(url);",
    ])
      expect(findGlobalMemberAccess(src, names), src).toEqual([]);
  });
});
