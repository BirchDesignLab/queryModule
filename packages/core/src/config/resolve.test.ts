import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFIG_SCHEMA_VERSION } from "../contracts/version";
import {
  checkMockCoverage,
  extendsOf,
  type RawFile,
  resolveSiteShape,
  validateResolved,
} from "./resolve";

const cfgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config");
const json = (rel: string): unknown => JSON.parse(readFileSync(resolve(cfgDir, rel), "utf8"));
const file = (rel: string): RawFile => ({ ok: true, value: json(rel) });
const clone = <T>(v: T): T => structuredClone(v);
const ok = (value: unknown): RawFile => ({ ok: true, value });

type Mut = Record<string, unknown>;
type MockDoc = {
  siteId: unknown;
  sources: Record<string, { responses: Array<{ queryType: string }> }>;
};

const e = (path: string, key: string, params: Record<string, string> = {}) => ({
  level: "error",
  path,
  key,
  params,
});

describe("BR-001 config chain (spec 5.8)", () => {
  const def = file("sites/default.json");
  const example = file("sites/example-ok.json");

  it("extendsOf reads the base id, never echoing an invalid value", () => {
    expect(extendsOf(json("sites/default.json"))).toEqual({ ok: true, id: null });
    expect(extendsOf(json("sites/example-ok.json"))).toEqual({ ok: true, id: "default" });
    expect(extendsOf({ extends: "../x" })).toEqual({
      ok: false,
      errors: [e("/extends", "config.schema", { code: "invalid_format" })],
    });
    expect(extendsOf({ extends: 5 }).ok).toBe(false);
    expect(extendsOf(null)).toEqual({ ok: true, id: null });
  });

  it("resolveSiteShape merges example-ok over default", () => {
    const r = resolveSiteShape(example, { id: "default", file: def });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.extendsChain).toEqual(["default"]);
    expect(r.config.defaults.state).toBe("OK");
    expect(r.config.terminal.delimiter).toBe("/");
    const text = JSON.stringify(r.config.queryTypes);
    expect(text).not.toContain("BOAT");
    expect(text).toContain("tagSticker");
  });

  it("resolveSiteShape on a base-less site has an empty chain", () => {
    const r = resolveSiteShape(def);
    expect(r.ok && r.extendsChain).toEqual([]);
  });

  const cases: Array<[string, () => ReturnType<typeof resolveSiteShape>, unknown[]]> = [
    ["site invalid JSON", () => resolveSiteShape({ ok: false }), [e("", "config.invalidJson")]],
    ["site missing", () => resolveSiteShape(ok(undefined)), [e("", "config.fileMissing")]],
    [
      "bad extends id",
      () => resolveSiteShape(ok({ schemaVersion: 1, extends: "../x" })),
      [e("/extends", "config.schema", { code: "invalid_format" })],
    ],
    [
      "no base supplied",
      () => resolveSiteShape(example),
      [e("/extends", "config.unknownBase", { extends: "default" })],
    ],
    [
      "base missing",
      () => resolveSiteShape(example, { id: "default", file: ok(undefined) }),
      [e("/extends", "config.unknownBase", { extends: "default" })],
    ],
    [
      "base invalid JSON",
      () => resolveSiteShape(example, { id: "default", file: { ok: false } }),
      [e("/extends", "config.invalidJson", { extends: "default" })],
    ],
  ];
  for (const [name, run, expected] of cases)
    it(`resolveSiteShape: ${name}`, () => {
      const r = run();
      expect(r.ok ? [] : r.errors).toEqual(expected);
    });

  it("a base that itself extends gives the merge error", () => {
    const base = clone(json("sites/default.json")) as Mut;
    base.extends = "other";
    const r = resolveSiteShape(example, { id: "default", file: ok(base) });
    expect(r.ok).toBe(false);
    expect(r.ok ? 0 : r.errors.length).toBeGreaterThan(0);
  });

  it("a newer site gives the migrate error; a newer base too", () => {
    const newer = {
      ...(clone(json("sites/default.json")) as Mut),
      schemaVersion: CONFIG_SCHEMA_VERSION + 1,
    };
    const a = resolveSiteShape(ok(newer));
    expect(a.ok ? "" : a.errors[0]?.key).toBe("config.schemaVersionTooNew");
    const b = resolveSiteShape(example, { id: "default", file: ok(newer) });
    expect(b.ok ? "" : b.errors[0]?.key).toBe("config.schemaVersionTooNew");
  });

  it("an unknown top-level key fails strict parse, and merged is returned", () => {
    const site = { ...(clone(json("sites/default.json")) as Mut), bogus: 1 };
    const r = resolveSiteShape(ok(site));
    if (r.ok) throw new Error("expected failure");
    expect(r.errors.every((d) => d.key === "config.schema")).toBe(true);
    expect(r.errors.map((d) => d.params.code)).toContain("unrecognized_keys");
    expect(r.merged).toBeDefined();
  });

  it("validateResolved: real en bundle is clean; unreadable bundle reported once", () => {
    const r = resolveSiteShape(example, { id: "default", file: def });
    if (!r.ok) throw new Error("shape");
    expect(validateResolved(r.config, { en: file("locales/en.json") }).errors).toEqual([]);
    const bad = validateResolved(r.config, { en: { ok: false } });
    expect(bad.errors).toEqual([e("/locales/0", "config.invalidJson", { locale: "en" })]);
    const missing = validateResolved(r.config, { en: ok(undefined) });
    expect(missing.errors.some((d) => d.key === "config.missingLocale")).toBe(true);
  });

  describe("checkMockCoverage", () => {
    const shape = () => {
      const r = resolveSiteShape(def);
      if (!r.ok) throw new Error("shape");
      return r.config;
    };
    const mockDoc = () => clone(json("mock/default.json")) as MockDoc;
    const label = "packages/config/mock/default.json";

    it("shipped mock is clean; a site without mock sources is skipped", () => {
      expect(checkMockCoverage(shape(), file("mock/default.json"), label)).toEqual([]);
      const c = shape();
      const noMock = { ...c, sources: c.sources.filter((s) => s.kind !== "mock") };
      expect(checkMockCoverage(noMock, { ok: false }, label)).toEqual([]);
    });

    it("invalid JSON points into the mock document and carries the label", () => {
      expect(checkMockCoverage(shape(), { ok: false }, label)).toEqual([
        e("/mock", "config.invalidJson", { siteId: "default", file: label }),
      ]);
    });

    it("missing mock file", () => {
      expect(checkMockCoverage(shape(), ok(undefined), label)).toEqual([
        e("/site/id", "config.missingMockFile", { siteId: "default" }),
      ]);
    });

    it("schema issues carry the label", () => {
      const m = mockDoc();
      m.siteId = 123;
      expect(checkMockCoverage(shape(), ok(m), label)).toContainEqual(
        e("/mock/siteId", "config.mockSchema", { code: "invalid_type", file: label }),
      );
    });

    it("site id mismatch", () => {
      const m = mockDoc();
      m.siteId = "other";
      expect(checkMockCoverage(shape(), ok(m), label)).toContainEqual(
        e("/site/id", "config.mockSiteMismatch", { siteId: "other" }),
      );
    });

    it("mock source without a spec", () => {
      const m = mockDoc();
      delete m.sources.nationalSource;
      expect(checkMockCoverage(shape(), ok(m), label)).toContainEqual(
        e("/sources/1/id", "config.missingMock", { sourceId: "nationalSource" }),
      );
    });

    it("mock source without a response for a served query type", () => {
      const m = mockDoc();
      const ns = m.sources.nationalSource;
      if (!ns) throw new Error("fixture");
      ns.responses = ns.responses.filter((r) => r.queryType !== "WNT");
      expect(checkMockCoverage(shape(), ok(m), label)).toContainEqual(
        e("/sources/1/id", "config.missingMockResponse", {
          sourceId: "nationalSource",
          queryType: "WNT",
        }),
      );
    });
  });
});
