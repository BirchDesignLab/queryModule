import { createResetController } from "@querymodule/client";
import { describe, expect, it } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import {
  buildSiteConfig,
  createConfigDraftStore,
  docFromClient,
  flattenBundle,
  parseRawDraft,
  registerConfigDraft,
  setAtPath,
  validateDraft,
} from "./draft.js";

describe("config draft (Task 31 part 1, BR-001, FR-060)", () => {
  it("docFromClient drops the hash and keeps the editable sections", () => {
    const doc = docFromClient(CLIENT_CONFIG);
    expect("configHash" in doc).toBe(false);
    expect(doc.terminal).toEqual(CLIENT_CONFIG.terminal);
    expect(Array.isArray(doc.queryTypes)).toBe(true);
  });

  it("setAtPath is immutable and touches only the addressed value", () => {
    const doc = { a: { b: [1, 2, 3] }, c: "x" };
    const next = setAtPath(doc, ["a", "b", 1], 9);
    expect(next).toEqual({ a: { b: [1, 9, 3] }, c: "x" });
    expect(doc.a.b[1]).toBe(2);
    expect(next.c).toBe(doc.c);
  });

  it("parseRawDraft returns the object, or a parse error message", () => {
    expect(parseRawDraft('{"a":1}')).toEqual({ ok: true, doc: { a: 1 } });
    const bad = parseRawDraft('{"a":');
    expect(bad.ok).toBe(false);
    expect(parseRawDraft("[1]").ok).toBe(false);
  });

  it("buildSiteConfig fills server-only parts and marks sources mock", () => {
    const built = buildSiteConfig(docFromClient(CLIENT_CONFIG));
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.config.sources.every((s) => s.kind === "mock")).toBe(true);
  });

  it("validateDraft runs validateSiteConfig with the bundle plus the draft overlay", () => {
    const doc = setAtPath(docFromClient(CLIENT_CONFIG), ["site", "labelKey"], "site.nope");
    const bundle = flattenBundle(EN_BUNDLE);
    const missing = validateDraft(doc, {}, bundle);
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.errors.map((e) => e.path)).toContain("/site/labelKey");
    const fixed = validateDraft(doc, { en: { "site.nope": "Nope" } }, bundle);
    expect(fixed.ok).toBe(true);
    if (fixed.ok) expect(fixed.errors.map((e) => e.path)).not.toContain("/site/labelKey");
  });

  it("validateDraft reports shape issues with JSON pointers", () => {
    const doc = setAtPath(docFromClient(CLIENT_CONFIG), ["terminal", "delimiter"], 5);
    const result = validateDraft(doc, {}, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((i) => i.pointer)).toContain("/terminal/delimiter");
  });

  it("the store edits the draft and the ResetController clears it (spec 6.7)", () => {
    const reset = createResetController();
    const store = createConfigDraftStore();
    registerConfigDraft(reset, store);
    store.getState().start(docFromClient(CLIENT_CONFIG));
    store.getState().setPath(["terminal", "delimiter"], ",");
    store.getState().setLabel("en", "site.nope", "Nope");
    expect(store.getState().doc?.terminal).toEqual({ delimiter: "," });
    expect(store.getState().labels).toEqual({ en: { "site.nope": "Nope" } });
    reset.resetAll();
    expect(store.getState().doc).toBeNull();
    expect(store.getState().labels).toEqual({});
  });

  it("start keeps an existing draft", () => {
    const store = createConfigDraftStore();
    store.getState().start({ a: 1 });
    store.getState().start({ a: 2 });
    expect(store.getState().doc).toEqual({ a: 1 });
  });
});
