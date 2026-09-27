import { describe, expect, it } from "vitest";
import {
  NOW,
  propertyConfig,
  ruleTestConfig,
  vehicleConfig,
} from "./__fixtures__/rules-fixtures.js";
import { evaluateForm } from "./evaluate-form.js";

const opts = { now: NOW };

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
