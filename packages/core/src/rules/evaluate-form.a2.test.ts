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

describe("SUBMIT-2 hidden values never decide the mode (spec 4.3 step 6, spec 10.3)", () => {
  const modeOf = (input: FormInput) => evaluateForm(vehicleConfig(), "VEH", input, opts);

  it("a stale Plate Type the rules hide leaves a plate-only query plate-only", () => {
    // State is empty (the site default applies), so a rule hides Plate Type: its kept value is a
    // leftover of an out-of-state query, not something the user entered for this one.
    const stale = modeOf({ plate: "ZZ-0001", state: "", plateType: "PC" });
    expect(stale.mode).toBe("plateOnly");
    expect(stale.values).not.toHaveProperty("plateType");
    expect(stale.hiddenWithValue).toEqual(["plateType"]);
    // The same answer as the form without the leftover: form and terminal cannot disagree.
    const fresh = modeOf({ plate: "ZZ-0001" });
    expect(stale.mode).toBe(fresh.mode);
    expect(stale.values).toEqual(fresh.values);
    expect(stale.sources).toEqual(fresh.sources);
  });

  it("an invalid hidden value does not make the query normal either", () => {
    expect(modeOf({ plate: "ZZ-0001", plateType: "not-a-code" }).mode).toBe("plateOnly");
  });

  it("a Plate Type the rules show still counts: State changed, so it is normal", () => {
    expect(modeOf({ plate: "ZZ-0001", state: "OK", plateType: "PC" }).mode).toBe("normal");
  });

  it("a visible field with an entry still makes the query normal", () => {
    expect(modeOf({ plate: "ZZ-0001", year: "2020", plateType: "PC" }).mode).toBe("normal");
  });
});
