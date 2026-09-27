import { describe, expect, it } from "vitest";
import { NOW, vehicleConfig } from "./__fixtures__/rules-fixtures.js";
import { evaluateForm } from "./evaluate-form.js";
import type { FormInput, FormMode } from "./types.js";

const opts = { now: NOW };
const visibleKeys = (input: FormInput) =>
  evaluateForm(vehicleConfig(), "VEH", input, opts)
    .fields.filter((f) => f.visible)
    .map((f) => f.key);

describe("FR-010 plate form initially shows Plate, State, Year and VIN", () => {
  it("[A1] opens with only Plate, State, Year and VIN", () => {
    expect(visibleKeys({})).toEqual(["plate", "state", "year", "vin"]);
  });
});

describe("FR-004 site default State", () => {
  it("[A1] State shows TX as a default, not a user value", () => {
    const state = evaluateForm(vehicleConfig(), "VEH", {}, opts).fields.find(
      (f) => f.key === "state",
    );
    expect(state).toMatchObject({ userValue: null, effectiveValue: "TX", isDefault: true });
  });
});

describe("FR-012 plate-only submit", () => {
  const cases: [string, FormInput, FormMode, Record<string, string | number>, string[], boolean][] =
    [
      [
        "A1 as written",
        { plate: "zz-0001" },
        "plateOnly",
        { plate: "ZZ-0001", state: "TX" },
        [],
        true,
      ],
      [
        "State changed",
        { plate: "zz-0001", state: "ok" },
        "normal",
        { plate: "ZZ-0001", state: "OK" },
        ["plateType"],
        false,
      ],
      [
        "Year typed",
        { plate: "zz-0001", year: "26" },
        "normal",
        { plate: "ZZ-0001", state: "TX", year: 2026 },
        [],
        true,
      ],
    ];
  it.each(cases)("[A1] %s", (_name, input, mode, values, missing, valid) => {
    const state = evaluateForm(vehicleConfig(), "VEH", input, opts);
    expect(state.mode).toBe(mode);
    expect(state.values).toEqual(values);
    expect(state.missingRequired).toEqual(missing);
    expect(state.valid).toBe(valid);
  });
  it("[A1] plate-only leaves source narrowing to the planner", () => {
    const state = evaluateForm(vehicleConfig(), "VEH", { plate: "zz-0001" }, opts);
    expect(state.sources.map((s) => s.sourceId)).toEqual(["stateDb", "nationalDb"]);
  });
  it("[A1] the empty form is blocked on Plate", () => {
    const state = evaluateForm(vehicleConfig(), "VEH", {}, opts);
    expect(state.missingRequired).toEqual(["plate"]);
    expect(state.valid).toBe(false);
  });
});
