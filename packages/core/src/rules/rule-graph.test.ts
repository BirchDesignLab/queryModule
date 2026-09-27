import { describe, expect, it } from "vitest";
import { type QueryType, QueryTypeSchema } from "../config/index.js";
import { ruleTestConfig } from "./__fixtures__/rules-fixtures.js";
import { conditionFields, validateRuleGraph } from "./rule-graph.js";

function qt(rules: unknown[]): QueryType {
  return QueryTypeSchema.parse({
    code: "G",
    labelKey: "queryType.g",
    sections: [{ key: "base", labelKey: "section.base" }],
    fields: ["a", "b", "c"].map((key) => ({ key, labelKey: `field.${key}`, dataType: "string" })),
    rules,
    sources: [{ sourceId: "src", selectedByDefault: true }],
  });
}

describe("FR-004 setDefault rule-set guarantees (spec 4.3)", () => {
  it("accepts the TST fixture", () => {
    const [tst] = ruleTestConfig().queryTypes;
    if (tst === undefined) throw new Error("fixture");
    expect(validateRuleGraph(tst, "/queryTypes/0")).toEqual([]);
  });
  it("rejects a two-rule cycle", () => {
    const diagnostics = validateRuleGraph(
      qt([
        { field: "a", when: { field: "b", op: "notEmpty" }, effect: "setDefault", value: "x" },
        { field: "b", when: { field: "a", op: "notEmpty" }, effect: "setDefault", value: "y" },
      ]),
      "/queryTypes/3",
    );
    expect(diagnostics.filter((d) => d.key === "config.setDefaultCycle")).toEqual([
      {
        level: "error",
        path: "/queryTypes/3/rules/0",
        key: "config.setDefaultCycle",
        params: { field: "a" },
      },
      {
        level: "error",
        path: "/queryTypes/3/rules/1",
        key: "config.setDefaultCycle",
        params: { field: "b" },
      },
    ]);
  });
  it("rejects a self cycle", () => {
    const diagnostics = validateRuleGraph(
      qt([{ field: "a", when: { field: "a", op: "empty" }, effect: "setDefault", value: "x" }]),
      "/q",
    );
    expect(diagnostics).toEqual([
      { level: "error", path: "/q/rules/0", key: "config.setDefaultCycle", params: { field: "a" } },
    ]);
  });
  it("$default references add no edge", () => {
    const diagnostics = validateRuleGraph(
      qt([
        {
          field: "a",
          when: { field: "b", op: "eq", value: { $default: "a" } },
          effect: "setDefault",
          value: "x",
        },
      ]),
      "/q",
    );
    expect(diagnostics).toEqual([]);
  });
  it("rejects a rule reading a field whose setDefault appears later", () => {
    const diagnostics = validateRuleGraph(
      qt([
        { field: "c", when: { field: "a", op: "eq", value: "x" }, effect: "show" },
        { field: "a", when: { field: "b", op: "empty" }, effect: "setDefault", value: "x" },
      ]),
      "/q",
    );
    expect(diagnostics).toEqual([
      {
        level: "error",
        path: "/q/rules/0/when",
        key: "config.ruleReadsLaterDefault",
        params: { field: "a", laterRule: 1 },
      },
    ]);
  });
});

describe("conditionFields", () => {
  it("collects leaf fields through all, any and not", () => {
    expect(
      conditionFields({
        all: [
          { field: "a", op: "empty" },
          { any: [{ field: "b", op: "empty" }, { not: { field: "c", op: "empty" } }] },
        ],
      }),
    ).toEqual(["a", "b", "c"]);
  });
});

function filterQt(rules: unknown[]): QueryType {
  return QueryTypeSchema.parse({
    code: "F",
    labelKey: "queryType.f",
    sections: [{ key: "base", labelKey: "section.base" }],
    fields: [
      { key: "hint", labelKey: "field.hint", dataType: "string" },
      { key: "parent", labelKey: "field.parent", dataType: "picklist", picklist: "parent" },
      {
        key: "child",
        labelKey: "field.child",
        dataType: "picklist",
        picklist: "child",
        picklistFilter: { byField: "parent" },
      },
    ],
    rules,
    sources: [{ sourceId: "src", selectedByDefault: true }],
  });
}

describe("FR-031 a setDefault rule may not target a picklist filter parent (decision 09-27-26)", () => {
  it("rejects setDefault on a field another picklist filters by", () => {
    const diagnostics = validateRuleGraph(
      filterQt([
        { field: "hint", when: { field: "child", op: "notEmpty" }, effect: "require" },
        {
          field: "parent",
          when: { field: "hint", op: "notEmpty" },
          effect: "setDefault",
          value: "P1",
        },
      ]),
      "/queryTypes/2",
    );
    expect(diagnostics).toEqual([
      {
        level: "error",
        path: "/queryTypes/2/rules/1",
        key: "config.setDefaultTargetsFilterParent",
        params: { field: "parent" },
      },
    ]);
  });
  it("accepts setDefault on a field no picklist filters by", () => {
    expect(
      validateRuleGraph(
        filterQt([
          {
            field: "hint",
            when: { field: "child", op: "notEmpty" },
            effect: "setDefault",
            value: "H",
          },
        ]),
        "/queryTypes/2",
      ),
    ).toEqual([]);
  });
  it("accepts a filter parent the user enters (no setDefault targets it)", () => {
    expect(
      validateRuleGraph(
        filterQt([{ field: "parent", when: { field: "hint", op: "notEmpty" }, effect: "require" }]),
        "/queryTypes/2",
      ),
    ).toEqual([]);
  });
});
