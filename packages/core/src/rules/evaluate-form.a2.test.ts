import { describe, expect, it } from "vitest";
import { NOW, vehicleConfig } from "./__fixtures__/rules-fixtures.js";
import { evaluateForm } from "./evaluate-form.js";
import type { FormInput } from "./types.js";

const opts = { now: NOW };
const field = (input: FormInput, key: string) =>
  evaluateForm(vehicleConfig(), "VEH", input, opts).fields.find((f) => f.key === key);

describe("FR-011 State changed from the site default exposes Plate Type", () => {
  it("[A2] TX to OK shows Plate Type", () => {
    expect(field({ plate: "ZZ-0001", state: "OK" }, "plateType")?.visible).toBe(true);
  });
});

describe("FR-002 required rule conditioned on another field", () => {
  it("[A2] Plate Type is required once State is OK", () => {
    const state = evaluateForm(vehicleConfig(), "VEH", { plate: "ZZ-0001", state: "OK" }, opts);
    expect(state.missingRequired).toEqual(["plateType"]);
    expect(state.errors).toEqual([{ key: "validation.required", params: { field: "plateType" } }]);
  });
});

describe("FR-003 in-state versus out-of-state round trip", () => {
  it("[A2] TX to OK to TX: hidden, not required, value not submitted, kept in the draft", () => {
    const draft = { plate: "ZZ-0001", state: "OK", plateType: "pc" };
    const out = evaluateForm(vehicleConfig(), "VEH", draft, opts);
    expect(out.values).toEqual({ plate: "ZZ-0001", state: "OK", plateType: "PC" });
    expect(out.valid).toBe(true);
    const back = evaluateForm(vehicleConfig(), "VEH", { ...draft, state: "TX" }, opts);
    const plateType = back.fields.find((f) => f.key === "plateType");
    expect(plateType).toMatchObject({ visible: false, required: false, userValue: "PC" });
    expect(back.values).toEqual({ plate: "ZZ-0001", state: "TX" });
    expect(back.hiddenWithValue).toEqual(["plateType"]);
    expect(back.valid).toBe(true);
  });
});

describe("UX-004 required fields are distinguishable", () => {
  it("[A2] FieldState.required flags Plate Type and not Year", () => {
    expect(field({ plate: "ZZ-0001", state: "OK" }, "plateType")?.required).toBe(true);
    expect(field({ plate: "ZZ-0001", state: "OK" }, "year")?.required).toBe(false);
  });
});
