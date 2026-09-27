import { describe, expect, it } from "vitest";
import { NOW, propertyConfig } from "./__fixtures__/rules-fixtures.js";
import { evaluateForm } from "./evaluate-form.js";
import type { FormInput } from "./types.js";

const opts = { now: NOW };
const pro = (input: FormInput) => evaluateForm(propertyConfig(), "PRO", input, opts);
const codes = (input: FormInput, key: string) =>
  pro(input)
    .fields.find((f) => f.key === key)
    ?.options?.map((o) => o.code);

describe("FR-031 property type is a site-narrowed picklist", () => {
  it("[B7] only enabled property types are listed", () => {
    expect(codes({}, "propertyType")).toEqual(["FIREARM", "ELECTRONICS"]);
  });
  it("[B7] a disabled code never appears and fails canonicalisation", () => {
    const state = pro({ propertyType: "boat" });
    expect(state.errors).toContainEqual({
      key: "validation.notInPicklist",
      params: { field: "propertyType" },
    });
    expect(JSON.stringify(state.fields)).not.toContain("KAYAK");
  });
});

describe("FR-032 required fields vary by property type", () => {
  it("[B7] FIREARM requires serial and caliber and shows the firearm section", () => {
    const state = pro({ propertyType: "firearm" });
    expect(state.missingRequired).toEqual(["serial", "caliber"]);
    expect(state.sections.find((s) => s.key === "firearm")?.visible).toBe(true);
  });
  it("[B7] ELECTRONICS requires neither", () => {
    const state = pro({ propertyType: "electronics" });
    expect(state.missingRequired).toEqual([]);
    expect(state.valid).toBe(true);
  });
  it("[B7] child options follow the parent and a stale child reads as empty", () => {
    expect(codes({ propertyType: "electronics" }, "propertyKind")).toEqual(["LAPTOP", "PHONE"]);
    const state = pro({ propertyType: "electronics", propertyKind: "rifle" });
    expect(state.fields.find((f) => f.key === "propertyKind")?.userValue).toBeNull();
    expect(state.errors).toContainEqual({
      key: "validation.notInPicklist",
      params: { field: "propertyKind" },
    });
  });
});
