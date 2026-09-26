import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isPureBarrel } from "./barrels";

const repoRoot = join(import.meta.dirname, "..", "..");

/** Every index.ts under the coverage include roots; vitest.config.ts excludes them from coverage. */
function indexFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name === "index.ts")
    .map((e) => relative(repoRoot, join(e.parentPath, e.name)).replaceAll("\\", "/"));
}

describe("coverage-excluded index.ts files are pure re-export barrels (plan amendment M3)", () => {
  it("accepts only export ... from statements", () => {
    expect(isPureBarrel('export * from "./a";\nexport { b, type C } from "./b";\n')).toBe(true);
    expect(isPureBarrel("export * as ns from './ns';\nexport type { T } from './t'\n")).toBe(true);
    expect(isPureBarrel('export {\n  a,\n  b,\n} from "./ab";\n')).toBe(true);
    expect(isPureBarrel('// comment\n/** doc */\nexport * from "./a";\n')).toBe(true);
    expect(isPureBarrel("")).toBe(true);
  });

  it("accepts compact and comment-split re-exports (review spec:CV2)", () => {
    expect(isPureBarrel('export { a } from "./a";export{b}from"./b";\n')).toBe(true);
    expect(isPureBarrel('export*from"./a";export*as ns from"./ns";export type{T}from"./t";')).toBe(
      true,
    );
    expect(isPureBarrel('export { a /* x */, b // y\n} from "./ab";\n')).toBe(true);
    expect(isPureBarrel('export /* x */ * /* y */ from /* z */ "./a";\n')).toBe(true);
    expect(isPureBarrel("exportconst X = 1;\n")).toBe(false);
    expect(isPureBarrel('export{a};export*from"./b";\n')).toBe(false);
  });

  it("rejects anything that is not export ... from", () => {
    expect(isPureBarrel('import en from "./en.json";\nexport const X = { en };\n')).toBe(false);
    expect(isPureBarrel('export * from "./a";\nexport const X = 1;\n')).toBe(false);
    expect(isPureBarrel("export { a };\n")).toBe(false);
    expect(isPureBarrel('export * from "./a";\nconsole.log(1);\n')).toBe(false);
  });

  it("holds for every index.ts under packages/*/src and scripts/ci", () => {
    const packages = readdirSync(join(repoRoot, "packages"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(repoRoot, "packages", e.name, "src"))
      .filter((d) => existsSync(d));
    const files = [...packages, join(repoRoot, "scripts", "ci")].flatMap(indexFilesUnder);
    expect(files.length).toBeGreaterThan(0);
    const impure = files.filter((f) => !isPureBarrel(readFileSync(join(repoRoot, f), "utf8")));
    expect(impure).toEqual([]);
  });
});
