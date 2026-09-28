import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHORTCUT_ACTIONS, SHORTCUT_CONTEXTS } from "./shortcuts";

const en: Record<string, string> = JSON.parse(
  readFileSync(new URL("../../../config/locales/en.json", import.meta.url), "utf8"),
);
const has = (key: string) => key in en || `${key}.one` in en || `${key}.other` in en;

/** Every "validation.*", "terminal.*" or "plan.*" string literal in the non-test sources of a core module. */
function emittedKeys(dir: string): string[] {
  const root = new URL(`../${dir}/`, import.meta.url);
  if (!existsSync(root)) return [];
  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("__fixtures__"),
  );
  return files.flatMap((f) =>
    [
      ...readFileSync(new URL(f.replaceAll("\\", "/"), root), "utf8").matchAll(
        /["'`]((?:validation|terminal|plan)\.[A-Za-z]+)["'`]/g,
      ),
    ].map((m) => m[1] as string),
  );
}

describe("NFR-001 every emitted message key has an en string", () => {
  it.each(["rules", "terminal", "planner"])("core %s", (dir) => {
    expect([...new Set(emittedKeys(dir))].filter((k) => !has(k))).toEqual([]);
  });
  it("the scan finds the rules keys", () => {
    expect(emittedKeys("rules")).toContain("validation.notInPicklist");
  });
  it("every shortcut action and context has a label", () => {
    const keys = [
      ...SHORTCUT_ACTIONS.map((a) => `shortcut.action.${a}`),
      ...SHORTCUT_CONTEXTS.map((c) => `shortcut.context.${c}`),
    ];
    expect(keys.filter((k) => !has(k))).toEqual([]);
  });
});
