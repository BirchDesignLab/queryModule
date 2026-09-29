import { describe, expect, it } from "vitest";
import { fromCoreDraft, toCoreDraft } from "./core-draft";

describe("FR-056 core Draft adapter (#297 type gap)", () => {
  it("toCoreDraft maps a cleared field '' to null", () => {
    expect(toCoreDraft({ plate: "A", state: "" })).toEqual({ plate: "A", state: null });
  });

  it("toCoreDraft keeps booleans and null", () => {
    expect(toCoreDraft({ flag: false, other: true, none: null })).toEqual({
      flag: false,
      other: true,
      none: null,
    });
  });

  it("fromCoreDraft maps null to '' and numbers to strings", () => {
    expect(fromCoreDraft({ plate: "A", state: null, year: 26 })).toEqual({
      plate: "A",
      state: "",
      year: "26",
    });
  });

  it("fromCoreDraft inverts toCoreDraft on strings and booleans", () => {
    const values = { plate: "ZZ-0001", state: "", flag: true, off: false };
    expect(fromCoreDraft(toCoreDraft(values))).toEqual(values);
  });

  it("own keys only: prototype-named keys round-trip as plain data", () => {
    const values = JSON.parse('{"__proto__":"x","constructor":""}') as Record<string, string>;
    const core = toCoreDraft(values);
    expect(Object.hasOwn(core, "__proto__")).toBe(true);
    expect(core.constructor).toBeNull();
    expect(fromCoreDraft(core)).toEqual(values);
  });
});
