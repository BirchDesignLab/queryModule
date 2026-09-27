import { describe, expect, it } from "vitest";
import { NOW, ruleTestConfig, vehicleConfig } from "./__fixtures__/rules-fixtures.js";
import { type CompiledQueryType, compileQueryType } from "./compile.js";
import { computeEffectiveValues, computeUserValues } from "./effective-values.js";
import type { FormInput, RulesConfig } from "./types.js";
import { computeVisibility, detectMode } from "./visibility.js";

function compiled(config: RulesConfig, code: string): CompiledQueryType {
  const qt = compileQueryType(config, code, NOW);
  if (qt === undefined) throw new Error(`missing ${code}`);
  return qt;
}

const veh = compiled(vehicleConfig(), "VEH");
const tst = compiled(ruleTestConfig(), "TST");

function visibility(qt: CompiledQueryType, input: FormInput) {
  const effective = computeEffectiveValues(qt, computeUserValues(qt, input, NOW).userValues);
  return computeVisibility(qt, effective, detectMode(qt, input));
}

function visibleKeys(qt: CompiledQueryType, input: FormInput): string[] {
  const v = visibility(qt, input);
  return qt.fields.map((f) => f.def.key).filter((k) => v.visible.get(k));
}

describe("FR-012 plate-only mode (spec 4.3 step 6)", () => {
  it.each([
    [{ plate: "ZZ-0001" }, "plateOnly"],
    [{ plate: "ZZ-0001", state: "  " }, "plateOnly"],
    [{ plate: "ZZ-0001", year: "abc" }, "normal"],
    [{ plate: "ZZ-0001", state: "ok" }, "normal"],
    [{ plate: "   " }, "normal"],
    [{}, "normal"],
  ] as const)("%j -> %s", (input, mode) => {
    expect(detectMode(veh, input)).toBe(mode);
  });
  it("needs allowPlateOnly and a plate field", () => {
    expect(detectMode(tst, { plate: "ZZ-0001" })).toBe("normal");
  });
  it("shows only the base section and requires nothing", () => {
    const v = visibility(veh, { plate: "ZZ-0001" });
    expect(v.sectionVisible.get("base")).toBe(true);
    expect(v.sectionVisible.get("expanded")).toBe(false);
    expect([...v.required.values()].every((r) => !r)).toBe(true);
  });
});

describe("FR-010 plate form initially shows Plate, State, Year and VIN", () => {
  it("hides Plate Type and the expanded section while State is the site default", () => {
    expect(visibleKeys(veh, {})).toEqual(["plate", "state", "year", "vin"]);
  });
});

describe("FR-011 State changed from the default exposes and requires Plate Type", () => {
  it("shows plateType and the expanded section", () => {
    const v = visibility(veh, { plate: "ZZ-0001", state: "OK" });
    expect(v.visible.get("plateType")).toBe(true);
    expect(v.required.get("plateType")).toBe(true);
  });
});

describe("FR-008 custom field in a conditionally expanded section", () => {
  it("tagSticker follows section.when", () => {
    expect(visibleKeys(veh, { plate: "ZZ-0001", state: "OK" })).toContain("tagSticker");
    expect(visibleKeys(veh, { plate: "ZZ-0001", state: "TX" })).not.toContain("tagSticker");
  });
});

describe("FR-002 show and hide: last match wins per channel", () => {
  it("a later matching show beats an earlier hide", () => {
    expect(visibility(tst, { unit: "quiet", flag: "Y" }).visible.get("note")).toBe(true);
  });
  it("hide applies when the later show does not match", () => {
    expect(visibility(tst, { unit: "quiet", flag: "N" }).visible.get("note")).toBe(false);
  });
});

describe("FR-003 require reads $default, frozen against setDefault", () => {
  it("setDefault moving priority off its configured default makes note required", () => {
    expect(visibility(tst, { mode: "urgent" }).required.get("note")).toBe(true);
    expect(visibility(tst, {}).required.get("note")).toBe(false);
  });
});

describe("UX-004 required is its own channel and never applies to hidden fields", () => {
  it("require never shows a field; a hidden field is never required", () => {
    const v = visibility(tst, { mode: "urgent", unit: "quiet" });
    expect(v.visible.get("note")).toBe(false);
    expect(v.required.get("note")).toBe(false);
  });
  it("show never requires a field", () => {
    const v = visibility(tst, { flag: "Y" });
    expect(v.visible.get("note")).toBe(true);
    expect(v.required.get("note")).toBe(false);
  });
});

describe("FR-001 fields required by FieldDef", () => {
  it("plate is required in normal mode", () => {
    expect(visibility(veh, {}).required.get("plate")).toBe(true);
  });
});
