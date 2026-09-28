import { describe, expect, it } from "vitest";
import { defaultSite } from "./__fixtures__/sites";
import { mergeDraft } from "./draft";
import { formatCommand, selectCommand } from "./format";
import * as terminal from "./index";
import { tokenize } from "./tokenize";
import type { Draft, TerminalConfig } from "./types";

const now = Date.UTC(2026, 8, 28);
const merge = (draft: Draft, input: string) =>
  mergeDraft(draft, tokenize(defaultSite, input), defaultSite);

describe("FR-056 draft merge (spec 4.4)", () => {
  it("writes positioned keys and keeps an unpositioned plateType", () => {
    expect(merge({ plate: "ZZ-0001", plateType: "PC" }, "VEH.ZZ-0002.OK.26")).toEqual({
      plate: "ZZ-0002",
      state: "OK",
      year: "26",
      vin: null,
      plateType: "PC",
    });
  });
  it("an empty interior position writes null", () => {
    expect(merge({ state: "OK" }, "VEH.ZZ-0001..26")).toMatchObject({ state: null });
  });
  it("an omitted or trailing-empty position writes null, rest included", () => {
    const d = { serial: "ZZ-0001", propertyType: "BOAT", description: "old" };
    expect(merge(d, "PRO.ZZ-0002..")).toEqual({
      serial: "ZZ-0002",
      propertyType: null,
      description: null,
    });
    expect(merge(d, "PRO")).toEqual({ serial: null, propertyType: null, description: null });
  });
  it("writes named keys", () => {
    expect(merge({ plateType: "PC" }, "VEH.ZZ-0001.OK.plateType=TK")).toMatchObject({
      plate: "ZZ-0001",
      plateType: "TK",
    });
  });
  it("writes preset keys", () => {
    const site: TerminalConfig = {
      ...defaultSite,
      commands: [
        {
          code: "PROF",
          queryType: "PRO",
          presets: { propertyType: "FIREARM" },
          positions: ["serial"],
        },
      ],
    };
    const t = tokenize(site, "PROF.ZZ-0001");
    expect(mergeDraft({ propertyType: "BOAT", description: "kept" }, t, site)).toEqual({
      propertyType: "FIREARM",
      serial: "ZZ-0001",
      description: "kept",
    });
  });
  it("a failed tokenize returns the same draft", () => {
    const d = { plate: "ZZ-0001" };
    expect(merge(d, "XYZ.1")).toBe(d);
  });
  it("is exported from the terminal index", () => {
    expect(terminal.mergeDraft).toBe(mergeDraft);
    expect(terminal.selectCommand).toBe(selectCommand);
  });
});

describe("FR-056 round trip: merge(D, tokenize(formatCommand(C, D))) equals D", () => {
  const trip = (d: Draft) => {
    const cmd = selectCommand(defaultSite, "PRO", d, { now });
    const text = formatCommand(defaultSite, cmd?.code ?? "", d, { now }).text;
    return mergeDraft(d, tokenize(defaultSite, text), defaultSite);
  };
  it.each([
    ["a rest value made only of delimiters", "..."],
    ["a rest value with interior delimiters", "x. y"],
    ["a blank rest value", null],
  ])("%s", (_name, description) => {
    const d = { serial: "ZZ-0001", propertyType: "BOAT", description };
    expect(trip(d)).toEqual(d);
  });
});

describe("FR-056 selectCommand (spec 4.4 toggle)", () => {
  const site: TerminalConfig = {
    ...defaultSite,
    commands: [
      { code: "PRO", queryType: "PRO", positions: ["serial"] },
      {
        code: "PROF",
        queryType: "PRO",
        presets: { propertyType: "FIREARM" },
        positions: ["serial"],
      },
      { code: "PRO2", queryType: "PRO", positions: ["serial", "description"] },
    ],
  };
  const pick = (queryType: string, draft: Draft) =>
    selectCommand(site, queryType, draft, { now })?.code;
  it("presets matching the draft (canonically) win", () => {
    expect(pick("PRO", { propertyType: "firearm" })).toBe("PROF");
  });
  it("a preset that does not match falls back to the first command without presets", () => {
    expect(pick("PRO", { propertyType: "BOAT" })).toBe("PRO");
    expect(pick("PRO", {})).toBe("PRO");
  });
  it("a query type with no command gives undefined", () => {
    expect(pick("WNT", {})).toBeUndefined();
  });
  it("most presets wins; ties go to config order", () => {
    const two: TerminalConfig = {
      ...defaultSite,
      commands: [
        { code: "P1", queryType: "PRO", presets: { propertyType: "BOAT" }, positions: [] },
        {
          code: "P2",
          queryType: "PRO",
          presets: { propertyType: "BOAT", serial: "ZZ-0001" },
          positions: [],
        },
        { code: "P3", queryType: "PRO", presets: { propertyType: "BOAT" }, positions: [] },
      ],
    };
    const sel = (d: Draft) => selectCommand(two, "PRO", d, { now })?.code;
    expect(sel({ propertyType: "BOAT", serial: "zz-0001" })).toBe("P2");
    expect(sel({ propertyType: "BOAT" })).toBe("P1");
  });
  it("a query type missing from the config matches only commands without presets", () => {
    const orphan: TerminalConfig = {
      ...defaultSite,
      commands: [
        { code: "Q1", queryType: "NOPE", presets: { x: "1" }, positions: [] },
        { code: "Q2", queryType: "NOPE", positions: [] },
      ],
    };
    expect(selectCommand(orphan, "NOPE", { x: "1" }, { now })?.code).toBe("Q2");
  });
});
