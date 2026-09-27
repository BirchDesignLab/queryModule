import { describe, expect, it } from "vitest";
import {
  cyclicPicklistConfig,
  NOW,
  propertyConfig,
  ruleTestConfig,
} from "./__fixtures__/rules-fixtures.js";
import { type CompiledQueryType, compileQueryType } from "./compile.js";
import { computeEffectiveValues, computeUserValues, optionsFor } from "./effective-values.js";
import type { FormInput, RulesConfig } from "./types.js";

function compiled(config: RulesConfig, code: string): CompiledQueryType {
  const qt = compileQueryType(config, code, NOW);
  if (qt === undefined) throw new Error(`missing ${code}`);
  return qt;
}

const tst = compiled(ruleTestConfig(), "TST");
const pro = compiled(propertyConfig(), "PRO");

function effective(input: FormInput) {
  const { userValues } = computeUserValues(tst, input, NOW);
  return { userValues, effective: computeEffectiveValues(tst, userValues) };
}

describe("FR-004 configured defaults and setDefault (spec 4.1 precedence, 4.3 step 3)", () => {
  it("applies FieldDef.defaultValue ?? QueryType.defaults ?? SiteConfig.defaults", () => {
    const { effective: e } = effective({});
    expect(e.get("priority")).toBe("LOW");
    expect(e.get("unit")).toBe("A1");
    expect(e.get("agency")).toBe("bdl");
    expect(e.get("mode")).toBeNull();
  });
  it("setDefault fills an empty user value when its condition holds", () => {
    const { userValues, effective: e } = effective({ mode: "urgent" });
    expect(e.get("priority")).toBe("HIGH");
    expect(userValues.get("priority")).toBeNull();
  });
  it("a later matching setDefault on the same target wins", () => {
    expect(effective({ mode: "urgent", count: "12" }).effective.get("priority")).toBe("CRITICAL");
  });
  it("never replaces a typed value", () => {
    expect(
      effective({ mode: "urgent", count: "12", priority: "med" }).effective.get("priority"),
    ).toBe("MED");
  });
  it("does nothing when no condition holds", () => {
    expect(effective({ count: "3" }).effective.get("priority")).toBe("LOW");
  });
  it("an invalid input reads as empty and falls back to the default", () => {
    const { userValues, effective: e } = effective({ count: "many" });
    expect(userValues.get("count")).toBeNull();
    expect(e.get("count")).toBeNull();
  });
});

describe("FR-031 picklist canonicalisation against enabled, filtered codes", () => {
  it("canonicalises a child after its parent even when the child is listed first", () => {
    const { userValues, errorsByField } = computeUserValues(
      pro,
      { propertyKind: "rifle", propertyType: "firearm" },
      NOW,
    );
    expect(userValues.get("propertyType")).toBe("FIREARM");
    expect(userValues.get("propertyKind")).toBe("RIFLE");
    expect(errorsByField.size).toBe(0);
  });
  it("rejects a disabled code", () => {
    const { userValues, errorsByField } = computeUserValues(pro, { propertyType: "boat" }, NOW);
    expect(userValues.get("propertyType")).toBeNull();
    expect(errorsByField.get("propertyType")).toEqual([
      { key: "validation.notInPicklist", params: { field: "propertyType" } },
    ]);
  });
  it("does not hang on a picklistFilter cycle", () => {
    const cyc = compiled(cyclicPicklistConfig(), "CYC");
    expect([...cyc.canonOrder].sort()).toEqual(["left", "right"]);
    expect(computeUserValues(cyc, { left: "a" }, NOW).userValues.get("left")).toBe("A");
  });
});

describe("FR-032 type-field options follow the parent value", () => {
  const kind = pro.fieldByKey.get("propertyKind");
  const type = pro.fieldByKey.get("propertyType");
  it("filters child options by parent code", () => {
    if (kind === undefined || type === undefined) throw new Error("fixture");
    expect(optionsFor(kind, "FIREARM").map((v) => v.code)).toEqual(["HANDGUN", "RIFLE"]);
    expect(optionsFor(kind, null)).toEqual([]);
    expect(optionsFor(type, "ignored").map((v) => v.code)).toEqual(["FIREARM", "ELECTRONICS"]);
  });
  it("a child value whose parent changed fails notInPicklist and reads as empty", () => {
    const { userValues, errorsByField } = computeUserValues(
      pro,
      { propertyType: "electronics", propertyKind: "rifle" },
      NOW,
    );
    expect(userValues.get("propertyKind")).toBeNull();
    expect(errorsByField.get("propertyKind")).toEqual([
      { key: "validation.notInPicklist", params: { field: "propertyKind" } },
    ]);
  });
});
