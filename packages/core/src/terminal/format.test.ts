import { describe, expect, it } from "vitest";
import type { FieldDef, QueryType } from "../config/index";
import { defaultSite } from "./__fixtures__/sites";
import { formatCommand, formatDate, formatValue } from "./format";
import * as terminal from "./index";
import type { Draft, TerminalConfig } from "./types";

const now = Date.UTC(2026, 8, 28);
const f = (code: string, values: Draft) => formatCommand(defaultSite, code, values, { now });

describe("FR-056 formatCommand (spec 4.4 toggle)", () => {
  it("interior empties kept, year emitted with four digits", () => {
    expect(f("VEH", { plate: "ABC123", state: null, year: "26" })).toEqual({
      text: "VEH.ABC123..2026",
      errors: [],
      unshownCount: 0,
    });
  });
  it("trailing empties dropped", () => {
    expect(f("VEH", { plate: "ABC123" }).text).toBe("VEH.ABC123");
    expect(f("VEH", { plate: "ABC123", state: "", year: null, vin: " " }).text).toBe("VEH.ABC123");
  });
  it("a command with no values is the bare code", () => {
    expect(f("VEH", {}).text).toBe("VEH");
  });
  it("a non-empty value outside positions and presets counts as unshown", () => {
    expect(f("VEH", { plate: "ABC123", plateType: "PC" })).toEqual({
      text: "VEH.ABC123",
      errors: [],
      unshownCount: 1,
    });
    expect(f("VEH", { plate: "ABC123", plateType: "" }).unshownCount).toBe(0);
  });
  it("emits user values only, never effective defaults (state default TX)", () => {
    expect(f("VEH", { plate: "ABC123", year: "2026" }).text).toBe("VEH.ABC123..2026");
  });
  it("PER date by the default outputFormat MMDDYYYY", () => {
    expect(f("PER", { last: "TESTPERSON", dob: "1901-01-01" }).text).toBe(
      "PER.TESTPERSON..01011901",
    );
  });
  it("picklist emits the canonical code", () => {
    expect(f("VEH", { plate: "ABC123", state: "ok" }).text).toBe("VEH.ABC123.OK");
  });
  it("a delimiter inside a non-rest value is terminal.delimiterInValue, text still emitted", () => {
    expect(f("VEH", { plate: "A.B" })).toEqual({
      text: "VEH.A.B",
      errors: [
        {
          key: "terminal.delimiterInValue",
          params: { field: "plate", labelKey: "field.plate", position: 1 },
        },
      ],
      unshownCount: 0,
    });
  });
  it("a delimiter inside the rest position is no error", () => {
    const r = f("PRO", { serial: "ZZ-0001", propertyType: "BOAT", description: "x. y" });
    expect(r).toEqual({ text: "PRO.ZZ-0001.BOAT.x. y", errors: [], unshownCount: 0 });
  });
  it("a value that fails canonicalisation is emitted as typed, trimmed", () => {
    expect(f("VEH", { plate: "ABC123", year: " abc " }).text).toBe("VEH.ABC123..abc");
  });
  it("an unknown command code is terminal.unknownCommand with empty text", () => {
    expect(f("XYZ", { plate: "ABC123" })).toEqual({
      text: "",
      errors: [{ key: "terminal.unknownCommand", params: { code: "XYZ" } }],
      unshownCount: 0,
    });
  });
  it("boolean emits Y or N, number emits its canonical form", () => {
    const base = defaultSite.queryTypes[0] as QueryType;
    const field = (key: string, dataType: FieldDef["dataType"]): FieldDef => ({
      ...(base.fields[0] as FieldDef),
      key,
      labelKey: `field.${key}`,
      dataType,
      required: false,
    });
    const site: TerminalConfig = {
      ...defaultSite,
      queryTypes: [
        {
          ...base,
          code: "TST",
          fields: [field("flag", "boolean"), field("count", "number")],
          rules: [],
        },
      ],
      commands: [{ code: "T", queryType: "TST", positions: ["flag", "count"] }],
    };
    expect(formatCommand(site, "T", { flag: "true", count: "-007" }, { now }).text).toBe("T.Y.-7");
    expect(formatCommand(site, "T", { flag: false, count: 0 }, { now }).text).toBe("T.N.0");
  });
  it("a position for a key the query type lacks emits the raw text, no labelKey", () => {
    const site: TerminalConfig = {
      ...defaultSite,
      commands: [{ code: "VX", queryType: "VEH", positions: ["plate", "bogus"] }],
    };
    expect(formatCommand(site, "VX", { plate: "ZZ-0001", bogus: " a.b " }, { now })).toEqual({
      text: "VX.ZZ-0001.a.b",
      errors: [{ key: "terminal.delimiterInValue", params: { field: "bogus", position: 2 } }],
      unshownCount: 0,
    });
  });
  it("the command code matches case-insensitively and emits the configured code", () => {
    expect(f("veh", { plate: "ABC123" }).text).toBe("VEH.ABC123");
  });
  it("is exported from the terminal index", () => {
    expect(terminal.formatCommand).toBe(formatCommand);
    expect(terminal.formatValue).toBe(formatValue);
    expect(terminal.formatDate).toBe(formatDate);
  });
});

describe("formatValue", () => {
  const veh = defaultSite.queryTypes.find((q) => q.code === "VEH") as QueryType;
  const state = veh.fields.find((x) => x.key === "state") as FieldDef;
  it("picklist canonical code against the given codes", () => {
    expect(formatValue(state, "ok", { now, codes: ["OK", "TX"] })).toBe("OK");
  });
  it("a code outside the given codes is emitted as typed", () => {
    expect(formatValue(state, " ok ", { now, codes: ["TX"] })).toBe("ok");
  });
  it("null and empty are empty", () => {
    expect(formatValue(state, null, { now })).toBe("");
    expect(formatValue(state, "  ", { now })).toBe("");
  });
});

describe("formatDate", () => {
  it.each([
    ["YYYY-MM-DD", "1901-02-03"],
    ["MM/DD/YY", "02/03/01"],
    ["DDMMYYYY", "03021901"],
    ["MMDDYYYY", "02031901"],
  ])("%s", (format, expected) => {
    expect(formatDate("1901-02-03", format)).toBe(expected);
  });
});
