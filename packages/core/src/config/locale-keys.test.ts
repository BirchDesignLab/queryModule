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

describe("NFR-001 every fixture policy key has an en string (#532 review Q2)", () => {
  it("each fixture.* key in fixture-policy.ts has a message", () => {
    const src = readFileSync(new URL("./fixture-policy.ts", import.meta.url), "utf8");
    const keys = [
      ...new Set([...src.matchAll(/"(fixture\.[A-Za-z]+)"/g)].map((m) => m[1] as string)),
    ];
    expect(keys).toHaveLength(7);
    expect(keys.filter((k) => !has(k))).toEqual([]);
  });
});

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
    "terminal.errorsLabel",
    "terminal.delimiterInValue",
    "mode.label",
    "mode.form",
    "mode.terminal",
    "panel.title",
    "form.submitKey",
    "form.clear",
    "form.timeoutSeconds",
    "echo.label",
    "echo.edit",
    "form.quickAccessHint",
    "submit.acknowledged",
    "submit.reference",
    "submit.copyReference",
    "submit.referenceCopied",
    "submit.configChanged",
    "submit.rateLimited",
    "submit.unavailable",
    "submit.noResponse",
    "submit.failed",
    "submit.forbidden",
    "requests.heading",
    "requests.lastHeading",
    "requests.empty",
    "requests.emptyLast",
    "requests.status.sending",
    "requests.status.acknowledged",
    "requests.status.failed",
    "requests.sentAt",
    "requests.copyReferenceOf",
    "requests.sourcePending",
    "requests.failure.invalid",
    "requests.failure.configChanged",
    "requests.failure.rateLimited",
    "requests.failure.forbidden",
    "requests.failure.unavailable",
    "requests.failure.noResponse",
    "requests.failure.failed",
  ];
  const plural = ["terminal.fieldsNotShown", "terminal.problems", "requests.count"];
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

describe("NFR-001 FR-043 per-source status strings (M2 P0.5 Task 6)", () => {
  const statuses = [
    "pending",
    "returned",
    "failed",
    "timedOut",
    "interrupted",
    "credentialsMissing",
    "credentialsRejected",
  ];
  it("every status has a word and the lines and summary exist", () => {
    const keys = [
      ...statuses.map((s) => `sourceStatus.status.${s}`),
      "sourceStatus.summary.one",
      "sourceStatus.summary.other",
      "sourceStatus.detail",
      "sourceStatus.heading",
      "sourceStatus.line",
      "sourceStatus.alsoRun",
      "sourceStatus.skipped",
    ];
    expect(keys.filter((k) => !(k in en))).toEqual([]);
  });
  it("the summary says counts and a reference, never a value", () => {
    expect(en["sourceStatus.summary.other"]).toContain("{reference}");
    expect(en["sourceStatus.summary.other"]).not.toMatch(/\{(value|payload|plate)/);
  });
});

describe("#382 W4 terminal.description is gone (the hint is built from the config)", () => {
  it("is not in en.json and the example and plain keys that replace it are", () => {
    expect("terminal.description" in en).toBe(false);
    expect(
      ["terminal.descriptionExample", "terminal.descriptionPlain"].filter((k) => !(k in en)),
    ).toEqual([]);
  });
});

/** Relative "/" paths of every file under root, never entering a node_modules directory. */
function filesUnder(root: URL, prefix = ""): string[] {
  return readdirSync(new URL(prefix, root), { withFileTypes: true }).flatMap((d) => {
    if (d.isDirectory())
      return d.name === "node_modules" ? [] : filesUnder(root, `${prefix}${d.name}/`);
    return [`${prefix}${d.name}`];
  });
}

describe("FR-006 form.readyToSubmit is gone (M1 P3 sends queries)", () => {
  it("is not in en.json", () => {
    expect("form.readyToSubmit" in en).toBe(false);
  });
  it("is in no source, e2e spec, locale or site file of the apps and packages", () => {
    // Every tree that can name a locale key: the web app and its e2e specs, the mobile app (its
    // sources sit at the app root, so node_modules is skipped), each package's sources, and the
    // shipped locale and site JSON (C6, #382: the old grep covered apps/web/src only).
    const repo = new URL("../../../../", import.meta.url);
    const roots = [
      "apps/web/src",
      "apps/web/e2e",
      "apps/mobile",
      ...readdirSync(new URL("packages/", repo), { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? [`packages/${d.name}/src`, `packages/${d.name}/locales`] : [],
      ),
      "packages/config/sites",
    ].filter((r) => existsSync(new URL(`${r}/`, repo)));
    const self = new URL("locale-keys.test.ts", import.meta.url).href;
    const hits = roots.flatMap((r) => {
      const root = new URL(`${r}/`, repo);
      return filesUnder(root)
        .filter((f) => /\.(tsx?|json)$/.test(f))
        .map((f) => new URL(f, root))
        .filter((u) => u.href !== self && readFileSync(u, "utf8").includes("readyToSubmit"))
        .map((u) => u.href.slice(repo.href.length));
    });
    expect(roots).toContain("apps/web/src");
    expect(roots).toContain("apps/mobile");
    expect(roots).toContain("packages/core/src");
    expect(hits).toEqual([]);
  });
});
