import { describe, expect, it } from "vitest";
import type { Condition } from "../config/index.js";
import {
  NOW,
  propertyConfig,
  ruleTestConfig,
  vehicleConfig,
} from "./__fixtures__/rules-fixtures.js";
import { type CompiledQueryType, compileCondition, compileQueryType } from "./compile.js";
import { evaluateCondition } from "./conditions.js";
import type { CanonicalValue, RulesConfig } from "./types.js";

type Values = Record<string, CanonicalValue | null>;

function compiled(config: RulesConfig, code: string): CompiledQueryType {
  const qt = compileQueryType(config, code, NOW);
  if (qt === undefined) throw new Error(`missing ${code}`);
  return qt;
}

function check(qt: CompiledQueryType, condition: Condition, values: Values): boolean {
  return evaluateCondition(
    compileCondition(condition, qt.fieldByKey, NOW),
    (f) => values[f] ?? null,
  );
}

const veh = compiled(vehicleConfig(), "VEH");
const tst = compiled(ruleTestConfig(), "TST");
const pro = compiled(propertyConfig(), "PRO");

describe("FR-002 conditions on other field values", () => {
  const cases: [string, Condition, Values, boolean][] = [
    ["eq literal canonicalised", { field: "state", op: "eq", value: "ok" }, { state: "OK" }, true],
    ["eq other value", { field: "state", op: "eq", value: "ok" }, { state: "TX" }, false],
    ["eq on empty", { field: "state", op: "eq", value: "ok" }, { state: null }, false],
    ["neq on empty", { field: "state", op: "neq", value: "ok" }, { state: null }, true],
    ["neq other", { field: "state", op: "neq", value: "ok" }, { state: "TX" }, true],
    ["in hit", { field: "state", op: "in", value: ["ok", "nm"] }, { state: "NM" }, true],
    ["in miss", { field: "state", op: "in", value: ["ok", "nm"] }, { state: "TX" }, false],
    ["in on empty", { field: "state", op: "in", value: ["ok"] }, { state: null }, false],
    ["notIn on empty", { field: "state", op: "notIn", value: ["ok"] }, { state: null }, true],
    ["notIn miss", { field: "state", op: "notIn", value: ["ok"] }, { state: "TX" }, true],
    ["notIn hit", { field: "state", op: "notIn", value: ["ok"] }, { state: "OK" }, false],
    ["empty", { field: "vin", op: "empty" }, { vin: null }, true],
    ["notEmpty", { field: "vin", op: "notEmpty" }, { vin: "X" }, true],
    [
      "all",
      {
        all: [
          { field: "state", op: "eq", value: "OK" },
          { field: "vin", op: "notEmpty" },
        ],
      },
      { state: "OK", vin: null },
      false,
    ],
    [
      "any",
      {
        any: [
          { field: "state", op: "eq", value: "OK" },
          { field: "vin", op: "notEmpty" },
        ],
      },
      { state: "OK", vin: null },
      true,
    ],
    ["not", { not: { field: "state", op: "eq", value: "OK" } }, { state: "TX" }, true],
    ["unknown field eq", { field: "colour", op: "eq", value: "x" }, {}, false],
    ["unknown field empty", { field: "colour", op: "empty" }, {}, true],
  ];
  it.each(cases)("%s", (_name, condition, values, expected) => {
    expect(check(veh, condition, values)).toBe(expected);
  });
});

describe("FR-003 in-state versus out-of-state through $default", () => {
  const notDefault: Condition = { field: "state", op: "neq", value: { $default: "state" } };
  it.each([
    ["OK", true],
    ["TX", false],
    [null, true],
  ] as const)("state %j -> %s", (state, expected) => {
    expect(check(veh, notDefault, { state })).toBe(expected);
  });
  it("eq $default", () => {
    expect(
      check(veh, { field: "state", op: "eq", value: { $default: "state" } }, { state: "TX" }),
    ).toBe(true);
  });
  it("$default of a field with no configured default never equals a value", () => {
    expect(check(veh, { field: "vin", op: "eq", value: { $default: "vin" } }, { vin: "X" })).toBe(
      false,
    );
  });
});

describe("FR-002 ordering operators on number, year and date", () => {
  const cases: [string, Condition, Values, boolean][] = [
    ["gt true", { field: "count", op: "gt", value: 5 }, { count: 6 }, true],
    ["gt equal", { field: "count", op: "gt", value: 5 }, { count: 5 }, false],
    ["gte equal", { field: "count", op: "gte", value: 5 }, { count: 5 }, true],
    ["lt", { field: "count", op: "lt", value: 5 }, { count: 4 }, true],
    ["lte equal", { field: "count", op: "lte", value: 5 }, { count: 5 }, true],
    ["lte greater", { field: "count", op: "lte", value: 5 }, { count: 6 }, false],
    ["gt on empty", { field: "count", op: "gt", value: 5 }, { count: null }, false],
    ["date lt", { field: "when", op: "lt", value: "01012026" }, { when: "2025-12-31" }, true],
    [
      "date lt equal",
      { field: "when", op: "lt", value: "01012026" },
      { when: "2026-01-01" },
      false,
    ],
    ["invalid literal", { field: "count", op: "gt", value: "abc" }, { count: 3 }, false],
    [
      "mismatched types",
      { field: "count", op: "gt", value: { $default: "priority" } },
      { count: 3 },
      false,
    ],
  ];
  it.each(cases)("%s", (_name, condition, values, expected) => {
    expect(check(tst, condition, values)).toBe(expected);
  });
  it("year literals canonicalise by century", () => {
    expect(check(veh, { field: "year", op: "gte", value: 26 }, { year: 2026 })).toBe(true);
    expect(check(veh, { field: "year", op: "gte", value: 26 }, { year: 2025 })).toBe(false);
  });
});

describe("FR-032 conditions on type fields", () => {
  it("compares canonical type codes", () => {
    expect(
      check(
        pro,
        { field: "propertyType", op: "eq", value: "firearm" },
        { propertyType: "FIREARM" },
      ),
    ).toBe(true);
  });
  it("a literal naming a disabled code still compiles (validation warns)", () => {
    expect(
      check(pro, { field: "propertyType", op: "eq", value: "boat" }, { propertyType: "BOAT" }),
    ).toBe(true);
  });
});

describe("FR-011 compileQueryType", () => {
  it("finds query types case-insensitively and returns undefined when absent", () => {
    expect(compileQueryType(vehicleConfig(), "veh", NOW)?.code).toBe("VEH");
    expect(compileQueryType(vehicleConfig(), "NOPE", NOW)).toBeUndefined();
  });
  it("freezes configured defaults as canonical values", () => {
    expect(veh.fieldByKey.get("state")?.configuredDefault).toBe("TX");
    expect(tst.fieldByKey.get("priority")?.configuredDefault).toBe("LOW");
    expect(veh.fieldByKey.get("vin")?.configuredDefault).toBeNull();
  });
  it("canonicalises setDefault values at load", () => {
    expect(tst.rules[0]?.value).toBe("HIGH");
    expect(tst.rules[2]?.value).toBeNull();
  });
  it("orders picklist fields after their filter parent", () => {
    expect(pro.canonOrder.indexOf("propertyType")).toBeLessThan(
      pro.canonOrder.indexOf("propertyKind"),
    );
    expect(pro.canonOrder).toHaveLength(5);
  });
});
