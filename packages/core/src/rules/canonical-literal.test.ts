import { describe, expect, it } from "vitest";
import { PicklistSchema, QueryTypeSchema } from "../config/schema";
import { canonicalCondition, canonicaliseLiteral, literalCodes } from "./canonical-literal";

const picklists = [
  PicklistSchema.parse({
    id: "states",
    values: [
      { code: "TX", labelKey: "picklist.states.tx" },
      { code: "OK", labelKey: "picklist.states.ok" },
      { code: "ZZ", labelKey: "picklist.states.zz", enabled: false },
    ],
  }),
];
const qt = QueryTypeSchema.parse({
  code: "VEH",
  labelKey: "queryType.veh",
  sections: [{ key: "base", labelKey: "section.base" }],
  fields: [
    { key: "state", labelKey: "field.state", dataType: "picklist", picklist: "states" },
    { key: "year", labelKey: "field.year", dataType: "year" },
    { key: "plate", labelKey: "field.plate", dataType: "string", maxLength: 8, transform: "upper" },
  ],
  rules: [],
  sources: [{ sourceId: "mock", selectedByDefault: true }],
});
const f = new Map(qt.fields.map((x) => [x.key, x]));
const field = (k: string) => {
  const def = f.get(k);
  if (def === undefined) throw new Error(`fixture has ${k}`);
  return def;
};
const now = Date.UTC(2026, 8, 28);

describe("FR-031 literal canonicalisation with errors (spec 4.2)", () => {
  it("canonicalises a picklist literal case-insensitively against the scope's codes", () => {
    expect(
      canonicaliseLiteral(field("state"), "ok", {
        now,
        codes: literalCodes(picklists, field("state"), "enabled"),
      }),
    ).toEqual({ value: "OK", errors: [] });
  });
  it("a disabled code fails the enabled scope and passes the all scope", () => {
    expect(
      canonicaliseLiteral(field("state"), "zz", {
        now,
        codes: literalCodes(picklists, field("state"), "enabled"),
      }).errors[0]?.key,
    ).toBe("validation.notInPicklist");
    expect(
      canonicaliseLiteral(field("state"), "zz", {
        now,
        codes: literalCodes(picklists, field("state"), "all"),
      }).value,
    ).toBe("ZZ");
  });
  it("reports the constraint a default breaks", () => {
    expect(canonicaliseLiteral(field("plate"), "ZZ-000001", { now }).errors[0]?.key).toBe(
      "validation.tooLong",
    );
    expect(canonicaliseLiteral(field("year"), 26, { now })).toEqual({ value: 2026, errors: [] });
  });
  it("literalCodes is undefined for a non-picklist field", () => {
    expect(literalCodes(picklists, field("year"), "all")).toBeUndefined();
  });
});

describe("FR-002 canonical condition key (#73)", () => {
  const key = (c: unknown) => canonicalCondition(c as never, f, picklists, now);
  it("equal for spelling, order and duplicate differences", () => {
    expect(key({ field: "state", op: "in", value: ["ok", "TX", "tx"] })).toBe(
      key({ field: "state", op: "in", value: ["TX", "OK"] }),
    );
    expect(
      key({
        all: [
          { field: "year", op: "gt", value: 26 },
          { field: "state", op: "eq", value: "ok" },
        ],
      }),
    ).toBe(
      key({
        all: [
          { field: "state", op: "eq", value: "OK" },
          { field: "year", op: "gt", value: 2026 },
        ],
      }),
    );
  });
  it("different for different conditions", () => {
    expect(key({ field: "state", op: "eq", value: "OK" })).not.toBe(
      key({ field: "state", op: "eq", value: "TX" }),
    );
    expect(key({ field: "state", op: "eq", value: "OK" })).not.toBe(
      key({ field: "state", op: "neq", value: "OK" }),
    );
    expect(key({ all: [{ field: "state", op: "empty" }] })).not.toBe(
      key({ any: [{ field: "state", op: "empty" }] }),
    );
  });
  it("keeps $default references symbolic", () => {
    expect(key({ field: "state", op: "neq", value: { $default: "state" } })).toContain(
      '"$default":"state"',
    );
  });
  it("normalises inside not and notIn, and keeps literals on an unknown field raw", () => {
    expect(key({ not: { field: "state", op: "notIn", value: ["tx", "ok"] } })).toBe(
      key({ not: { field: "state", op: "notIn", value: ["OK", "TX"] } }),
    );
    expect(key({ field: "colour", op: "eq", value: "red" })).toContain('"raw":"red"');
  });
  it("keeps a failing literal distinguishable instead of dropping it", () => {
    expect(key({ field: "year", op: "eq", value: "soon" })).not.toBe(
      key({ field: "year", op: "eq", value: "later" }),
    );
  });
});
