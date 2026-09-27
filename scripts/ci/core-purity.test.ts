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
      // Reflect.get
      'Reflect.get(globalThis, "fetch");',
      // computed non-literal key
      "globalThis[k];",
      // eval / Function: access built dynamically, not a static literal
      'eval("globalThis" + ".fetch(url)");\nnew Function("return globalThis" + ".fetch(url)")();',
    ])
      expect(findGlobalMemberAccess(src, names), src).toEqual([]);
  });

  // [critic:C1] an earlier, unrelated destructure must not hide a later real one
  it("still flags a destructure from a global object after an unrelated destructure", () => {
    expect(
      findGlobalMemberAccess("const { x } = opts;\nconst { fetch } = globalThis;", names),
    ).not.toEqual([]);
  });

  // [critic:I1] alias names containing `$` must not be treated as regex metacharacters
  it("flags aliases whose name contains a dollar sign", () => {
    for (const src of [
      "const $g = globalThis;\n$g.fetch(u);",
      "const $ = globalThis;\n$.fetch(u);",
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  // [critic:I2] a type annotation must not bypass alias or destructuring detection
  it("flags aliases and destructuring through a type annotation", () => {
    for (const src of [
      "const g: typeof globalThis = globalThis;\ng.fetch(u);",
      "const { fetch }: typeof globalThis = globalThis;",
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  // [critic:I3] default values, quoted keys and literal computed keys must still be caught
  it("flags destructured bindings with defaults or literal keys", () => {
    for (const src of [
      "const { fetch = undefined } = globalThis;",
      "const { 'fetch': f } = globalThis;",
      "const { ['fetch']: f } = globalThis;",
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  // [critic:re1:nested-destructure-brace-regression] a brace inside the binding list
  // (a nested destructuring pattern) must not make the whole destructure match fail.
  it("flags a destructure whose binding list itself contains a nested destructuring pattern", () => {
    for (const src of [
      "const { navigator: { userAgent } } = window;",
      "const { navigator: { userAgent } } = globalThis;",
      "const { a, navigator: { userAgent }, b } = window;",
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  // #184 item 1: the destructuring source must be exactly a global object (or chain),
  // ending the expression; `window.api` is not itself a global object.
  it("does not flag a destructure whose source is a member of a global object", () => {
    expect(findGlobalMemberAccess("const { fetch } = window.api;", names)).toEqual([]);
  });

  // #184 item 2: an optional-chain index counts as a chain link, not just a dot link.
  it("flags an optional-chain bracket index as a chain link", () => {
    for (const src of ["globalThis?.['window'].fetch", 'globalThis?.["window"]?.fetch'])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  // #184 item 3: one-level aliases in a non-first declarator, and through a cast.
  it("flags a one-level alias declared in a non-first declarator", () => {
    for (const src of [
      "let a = 1, g = globalThis;\ng.fetch(url);",
      "const g = globalThis, h = window;\ng.fetch(url);\nh.localStorage;",
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });

  it("flags a one-level alias declared with a cast", () => {
    for (const src of [
      "const g = globalThis as any;\ng.fetch(url);",
      "const g = globalThis as unknown as Window;\ng.fetch(url);",
    ])
      expect(findGlobalMemberAccess(src, names), src).not.toEqual([]);
  });
});
