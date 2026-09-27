import { describe, expect, it } from "vitest";
import { makeField, NOW } from "./__fixtures__/rules-fixtures.js";
import { canonicalise, isRawEmpty, rawText } from "./canonicalise.js";

const plate = makeField({
  key: "plate",
  dataType: "string",
  transform: "upper",
  maxLength: 10,
  minLength: 2,
  pattern: "[A-Z0-9 -]+",
});
const note = makeField({ key: "note", dataType: "string", charset: "printable" });
const state = makeField({ key: "state", dataType: "picklist", picklist: "state" });
const count = makeField({ key: "count", dataType: "number" });
const amount = makeField({ key: "amount", dataType: "number", numberKind: "decimal" });
const year = makeField({ key: "year", dataType: "year" });
const dob = makeField({ key: "dob", dataType: "date", century: "past" });
const flag = makeField({ key: "flag", dataType: "boolean" });
const ctx = { now: NOW, codes: ["TX", "OK"] };

describe("empty input (spec 4.3 step 2)", () => {
  it.each([null, undefined, "", "   "])("%j is null with no error", (raw) => {
    expect(canonicalise(plate, raw, ctx)).toEqual({ value: null, errors: [] });
    expect(isRawEmpty(raw)).toBe(true);
  });
  it("rawText trims and stringifies", () => {
    expect(rawText(26)).toBe("26");
    expect(rawText(false)).toBe("false");
    expect(isRawEmpty(false)).toBe(false);
  });
});

describe("FR-005 string constraints", () => {
  it("trims, collapses whitespace and applies transform", () => {
    expect(canonicalise(plate, "  zz \t 0001 ", ctx)).toEqual({ value: "ZZ 0001", errors: [] });
  });
  it("reports every failing constraint with message keys only", () => {
    const result = canonicalise(plate, "é", ctx);
    expect(result.value).toBeNull();
    expect(result.errors).toEqual([
      { key: "validation.invalidCharacter", params: { field: "plate" } },
      { key: "validation.tooShort", params: { field: "plate", min: 2 } },
      { key: "validation.patternMismatch", params: { field: "plate" } },
    ]);
  });
  it("rejects too long values", () => {
    expect(canonicalise(plate, "ZZ-00000000", ctx).errors).toEqual([
      { key: "validation.tooLong", params: { field: "plate", max: 10 } },
    ]);
  });
  it("printable charset admits Unicode but not control or format characters", () => {
    expect(canonicalise(note, "Café Straße", ctx).value).toBe("Café Straße");
    expect(canonicalise(note, "a​b", ctx).errors).toEqual([
      { key: "validation.invalidCharacter", params: { field: "note" } },
    ]);
  });
});

describe("FR-031 picklist canonicalisation", () => {
  it("matches case-insensitively to the configured code", () => {
    expect(canonicalise(state, " ok ", ctx)).toEqual({ value: "OK", errors: [] });
  });
  it("rejects codes outside the allowed list", () => {
    expect(canonicalise(state, "zz", ctx).errors).toEqual([
      { key: "validation.notInPicklist", params: { field: "state" } },
    ]);
    expect(canonicalise(state, "tx", { now: NOW }).errors).toEqual([
      { key: "validation.notInPicklist", params: { field: "state" } },
    ]);
  });
});

describe("FR-005 numbers", () => {
  it.each([
    ["integer", "42", 42],
    ["negative", "-7", -7],
    ["negative zero", "-0", 0],
    ["number input", 26, 26],
  ] as const)("integer %s parses", (_name, raw, expected) => {
    expect(canonicalise(count, raw, ctx)).toEqual({ value: expected, errors: [] });
  });
  it.each([
    ["1.50", 1.5],
    ["-0.0", 0],
  ] as const)("decimal %s parses", (raw, expected) => {
    expect(canonicalise(amount, raw, ctx)).toEqual({ value: expected, errors: [] });
  });
  it.each(["1.5", "1e3", "99999999999999999999"])("integer rejects %s", (raw) => {
    expect(canonicalise(count, raw, ctx).errors).toEqual([
      { key: "validation.invalidNumber", params: { field: "count" } },
    ]);
  });
  it.each(["1.", "0.0000001", "123456789012345678901234"])("decimal rejects %s", (raw) => {
    expect(canonicalise(amount, raw, ctx).errors).toEqual([
      { key: "validation.invalidNumber", params: { field: "amount" } },
    ]);
  });
});

describe("FR-005 years and dates", () => {
  it("resolves years", () => {
    expect(canonicalise(year, 26, ctx).value).toBe(2026);
    expect(canonicalise(year, "2x", ctx).errors).toEqual([
      { key: "validation.invalidYear", params: { field: "year" } },
    ]);
  });
  it("tries inputFormats then ISO", () => {
    expect(canonicalise(dob, "01/02/1901", ctx).value).toBe("1901-01-02");
    expect(canonicalise(dob, "1901-01-02", ctx).value).toBe("1901-01-02");
    expect(canonicalise(dob, "02/30/1901", ctx).errors).toEqual([
      { key: "validation.invalidDate", params: { field: "dob" } },
    ]);
  });
});

describe("FR-005 booleans", () => {
  it.each([
    ["Y", true],
    ["n", false],
    ["1", true],
    ["0", false],
    ["TRUE", true],
    [false, false],
  ] as const)("%j -> %j", (raw, expected) => {
    expect(canonicalise(flag, raw, ctx).value).toBe(expected);
  });
  it("rejects other tokens", () => {
    expect(canonicalise(flag, "maybe", ctx).errors).toEqual([
      { key: "validation.invalidBoolean", params: { field: "flag" } },
    ]);
  });
});
