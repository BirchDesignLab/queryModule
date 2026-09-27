import { describe, expect, it } from "vitest";
import { NOW, vehicleConfig } from "./__fixtures__/rules-fixtures.js";
import { evaluateForm } from "./evaluate-form.js";

const opts = { now: NOW };

describe("FR-005 submission blocked while required fields are empty", () => {
  it("[A3] an empty required field blocks submit and names the field", () => {
    const state = evaluateForm(vehicleConfig(), "VEH", { year: "26" }, opts);
    expect(state.valid).toBe(false);
    expect(state.missingRequired).toEqual(["plate"]);
    expect(state.errors).toEqual([{ key: "validation.required", params: { field: "plate" } }]);
  });
  it("[A3] a field with a canonicalisation error is not also missingRequired", () => {
    const state = evaluateForm(vehicleConfig(), "VEH", { plate: "ABCDEFGHIJKLMN" }, opts);
    expect(state.missingRequired).toEqual([]);
    expect(state.errors).toEqual([
      { key: "validation.tooLong", params: { field: "plate", max: 10 } },
    ]);
  });
  it("[A3] errors are message keys whose params never carry the typed value", () => {
    const typed = "ABCDEFGHIJKLMN";
    const state = evaluateForm(vehicleConfig(), "VEH", { plate: typed, year: "nineteen" }, opts);
    for (const error of state.errors) {
      expect(error.key).toMatch(/^validation\./);
      expect(typeof error.params?.field).toBe("string");
    }
    expect(JSON.stringify(state.errors)).not.toContain(typed);
    expect(JSON.stringify(state.errors)).not.toContain("nineteen");
  });
});

describe("FR-001 fields required by site rules", () => {
  it("[A3] both FieldDef.required and a require rule feed missingRequired in field order", () => {
    const state = evaluateForm(vehicleConfig(), "VEH", { state: "OK" }, opts);
    expect(state.missingRequired).toEqual(["plate", "plateType"]);
  });
});
