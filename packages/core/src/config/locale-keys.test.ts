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

describe("NFR-001 M1 P3 submit, acknowledgment, mode and terminal UI strings", () => {
  const single = [
    "terminal.label",
    "terminal.description",
    "terminal.errorsLabel",
    "terminal.delimiterInValue",
    "mode.label",
    "mode.form",
    "mode.terminal",
    "panel.title",
    "form.quickAccessHint",
    "submit.acknowledged",
    "submit.reference",
    "submit.copyReference",
    "submit.referenceCopied",
    "submit.sentHeading",
    "submit.configChanged",
    "submit.rateLimited",
    "submit.unavailable",
    "submit.noResponse",
    "submit.failed",
    "submit.forbidden",
    "submit.partSkipped",
  ];
  const plural = ["terminal.fieldsNotShown", "terminal.problems"];
  it("every key exists", () => {
    expect(single.filter((k) => !(k in en))).toEqual([]);
  });
  it("plural keys have .one and .other", () => {
    const forms = plural.flatMap((k) => [`${k}.one`, `${k}.other`]);
    expect(forms.filter((k) => !(k in en))).toEqual([]);
  });
  it("#382 A1 submit.partNotRun names the type and claims no reason", () => {
    expect(en["submit.partNotRun"]).toContain("{queryType}");
    expect(en["submit.partNotRun"]).not.toContain("{reason}");
  });
  it("#382 A3 submit.noResponse does not tell a gated user to submit again now", () => {
    expect(en["submit.noResponse"]).not.toMatch(/Submit again/i);
  });
  it("FR-055 terminal.delimiterInValue names the label, not the delimiter (D-B9)", () => {
    expect(en["terminal.delimiterInValue"]).toContain("{label}");
    expect(en["terminal.delimiterInValue"]).not.toContain("{delimiter}");
  });
});

describe("FR-006 form.readyToSubmit is gone (M1 P3 sends queries)", () => {
  it("is not in en.json", () => {
    expect("form.readyToSubmit" in en).toBe(false);
  });
  it("is in no web source file", () => {
    const root = new URL("../../../../apps/web/src/", import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
      (f) => /\.tsx?$/.test(f) && !f.endsWith("locale-keys.test.ts"),
    );
    const hits = files.filter((f) =>
      readFileSync(new URL(f.replaceAll("\\", "/"), root), "utf8").includes("readyToSubmit"),
    );
    expect(hits).toEqual([]);
  });
});
