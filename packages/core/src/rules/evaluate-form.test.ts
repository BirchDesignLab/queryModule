import { describe, expect, it } from "vitest";
import {
  makeConfig,
  NOW,
  propertyConfig,
  ruleTestConfig,
  vehicleConfig,
} from "./__fixtures__/rules-fixtures.js";
import { evaluateForm } from "./evaluate-form.js";

const opts = { now: NOW };

// B1/B2 carry-forward (Task 6 ruling spec:CV1): parent set only by setDefault.
function setDefaultParentConfig() {
  return makeConfig({
    defaults: {},
    picklists: [
      {
        id: "kindType",
        values: [
          { code: "FIREARM", labelKey: "kindType.firearm" },
          { code: "ELECTRONICS", labelKey: "kindType.electronics" },
        ],
      },
      {
        id: "kindSub",
        values: [
          { code: "HANDGUN", labelKey: "kindSub.handgun", parent: "FIREARM" },
          { code: "LAPTOP", labelKey: "kindSub.laptop", parent: "ELECTRONICS" },
        ],
      },
    ],
    queryTypes: [
      {
        code: "SDP",
        labelKey: "queryType.sdp",
        sections: [{ key: "base", labelKey: "section.base" }],
        fields: [
          { key: "hint", labelKey: "field.hint", dataType: "string", transform: "upper" },
          {
            key: "kindType",
            labelKey: "field.kindType",
            dataType: "picklist",
            picklist: "kindType",
          },
          {
            key: "kindSub",
            labelKey: "field.kindSub",
            dataType: "picklist",
            picklist: "kindSub",
            picklistFilter: { byField: "kindType" },
          },
        ],
        rules: [
          {
            field: "kindType",
            when: { field: "hint", op: "eq", value: "F" },
            effect: "setDefault",
            value: "FIREARM",
          },
        ],
        sources: [{ sourceId: "sdp", selectedByDefault: true }],
      },
    ],
  });
}

describe("FR-031 child picklist when the parent is set only by setDefault (spec 4.1, 4.3)", () => {
  it("options follow the parent's effective value after setDefault", () => {
    const state = evaluateForm(setDefaultParentConfig(), "SDP", { hint: "f" }, opts);
    expect(state.values.kindType).toBe("FIREARM");
    const sub = state.fields.find((f) => f.key === "kindSub");
    expect(sub?.options?.map((o) => o.code)).toEqual(["HANDGUN"]);
  });
  it("step 2 is one pass: a typed child checks against the parent's canonical value, so it fails notInPicklist", () => {
    // Spec 4.3 step 2 canonicalises against the parent's canonical value and runs once; it is not
    // re-run after step 3. Controller ruling 09-27-26: keep one pass (spec binding); the gap is
    // raised as a spec question in the B2 PR.
    const state = evaluateForm(
      setDefaultParentConfig(),
      "SDP",
      { hint: "f", kindSub: "handgun" },
      opts,
    );
    expect(state.errors).toContainEqual({
      key: "validation.notInPicklist",
      params: { field: "kindSub" },
    });
    expect(state.values.kindSub).toBeUndefined();
  });
});

describe("evaluateForm assembly (spec 4.3 steps 1, 7, 8)", () => {
  it("unknown query type is an error, never a throw", () => {
    const state = evaluateForm(vehicleConfig(), "NOPE", {}, opts);
    expect(state.errors).toEqual([
      { key: "validation.unknownQueryType", params: { queryType: "NOPE" } },
    ]);
    expect(state.valid).toBe(false);
    expect(state.fields).toEqual([]);
  });
  it("matches the query type code case-insensitively", () => {
    expect(evaluateForm(vehicleConfig(), "veh", {}, opts).queryType).toBe("VEH");
  });
  it("rejects unknown input keys with validation.unknownField first", () => {
    const state = evaluateForm(
      vehicleConfig(),
      "VEH",
      { colour: "RED", plate: "ZZ-0001", year: "2x" },
      opts,
    );
    expect(state.errors).toEqual([
      { key: "validation.unknownField", params: { field: "colour" } },
      { key: "validation.invalidYear", params: { field: "year" } },
    ]);
    expect(state.valid).toBe(false);
  });
  it("a hidden field's value is absent from values and listed in hiddenWithValue", () => {
    const state = evaluateForm(
      ruleTestConfig(),
      "TST",
      { unit: "quiet", note: "kept in draft" },
      opts,
    );
    expect(state.values).not.toHaveProperty("note");
    expect(state.hiddenWithValue).toEqual(["note"]);
  });
  it("sources are filtered by when against submitted values", () => {
    expect(evaluateForm(ruleTestConfig(), "TST", {}, opts).sources.map((s) => s.sourceId)).toEqual([
      "alpha",
    ]);
    expect(evaluateForm(ruleTestConfig(), "TST", { unit: "b2" }, opts).sources).toEqual([
      { sourceId: "alpha", selectedByDefault: true, plateOnly: false },
      { sourceId: "beta", selectedByDefault: false, plateOnly: false },
    ]);
  });
  it("values hold canonical dates and booleans", () => {
    const state = evaluateForm(ruleTestConfig(), "TST", { when: "09252026", flag: "n" }, opts);
    expect(state.values.when).toBe("2026-09-25");
    expect(state.values.flag).toBe(false);
  });
  it("isDefault marks configured and rule defaults, not typed values", () => {
    const unitOf = (unit: string | null) =>
      evaluateForm(ruleTestConfig(), "TST", { unit }, opts).fields.find((f) => f.key === "unit");
    expect(unitOf(null)?.isDefault).toBe(true);
    expect(unitOf("x")?.isDefault).toBe(false);
  });
  it("builds FieldState with order, section label, role and options", () => {
    const state = evaluateForm(propertyConfig(), "PRO", { propertyType: "firearm" }, opts);
    const kind = state.fields.find((f) => f.key === "propertyKind");
    expect(kind).toEqual({
      key: "propertyKind",
      labelKey: "field.propertyKind",
      dataType: "picklist",
      role: "type",
      order: 1,
      section: "base",
      sectionLabelKey: "section.base",
      visible: true,
      required: false,
      userValue: null,
      effectiveValue: null,
      isDefault: false,
      options: [
        { code: "HANDGUN", labelKey: "propertyKind.handgun" },
        { code: "RIFLE", labelKey: "propertyKind.rifle" },
      ],
    });
    expect(state.sections).toEqual([
      { key: "base", labelKey: "section.base", visible: true },
      { key: "firearm", labelKey: "section.firearm", visible: true },
    ]);
  });
});
