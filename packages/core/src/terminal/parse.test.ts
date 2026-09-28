import { describe, expect, it } from "vitest";
import { defaultSite } from "./__fixtures__/sites";
import * as terminal from "./index";
import { parseCommand } from "./parse";

const now = Date.UTC(2026, 8, 28);
const p = (input: string) => parseCommand(defaultSite, input, { now });

describe("FR-055 validation errors carry labelKey and position", () => {
  it("VEH.ABC123.OK: plateType required, no position (only a named token can set it)", () => {
    expect(p("VEH.ABC123.OK").errors).toEqual([
      { key: "validation.required", params: { field: "plateType", labelKey: "field.plateType" } },
    ]);
  });
  it("VEH.ABC123.OK.plateType=PC is valid", () => {
    const r = p("VEH.ABC123.OK.plateType=PC");
    expect(r.errors).toEqual([]);
    expect(r.formState?.valid).toBe(true);
    expect(r.formState?.values).toMatchObject({ state: "OK", plateType: "PC" });
  });
  it("PER..PAT: last required at position 1", () => {
    expect(p("PER..PAT").errors).toEqual([
      {
        key: "validation.required",
        params: { field: "last", labelKey: "field.last", position: 1 },
      },
    ]);
  });
  it("VEH.ABC123.QQ: state not in picklist at position 2", () => {
    expect(p("VEH.ABC123.QQ").errors).toEqual([
      {
        key: "validation.notInPicklist",
        params: { field: "state", labelKey: "field.state", position: 2 },
      },
    ]);
  });
  it("a named token for a positioned field still reports the field's position", () => {
    expect(p("VEH.ABC123.state=QQ").errors).toEqual([
      {
        key: "validation.notInPicklist",
        params: { field: "state", labelKey: "field.state", position: 2 },
      },
    ]);
  });
  it("a position for a key the query type lacks keeps unknownField without a labelKey", () => {
    const site = {
      ...defaultSite,
      commands: [{ code: "VX", queryType: "VEH", positions: ["plate", "bogus"] }],
    };
    expect(parseCommand(site, "VX.ZZ-0001.X", { now }).errors).toEqual([
      { key: "validation.unknownField", params: { field: "bogus", position: 2 } },
    ]);
  });
  it("tokenize and validation errors come back together", () => {
    const keys = p("VEH.ABC123.QQ.26.V1.x").errors.map((e) => e.key);
    expect(keys).toEqual(["terminal.tooManyPositions", "validation.notInPicklist"]);
  });
});

describe("spec 4.4 terminal.valueForHiddenField", () => {
  it("VEH.ABC123.TX.plateType=PC: hidden field value is an error and stays in userValues", () => {
    const r = p("VEH.ABC123.TX.plateType=PC");
    expect(r.errors).toEqual([
      {
        key: "terminal.valueForHiddenField",
        params: { field: "plateType", labelKey: "field.plateType" },
      },
    ]);
    expect(r.userValues.plateType).toBe("PC");
    expect(r.formState?.hiddenWithValue).toEqual(["plateType"]);
  });
});

describe("spec 4.4 Draft merge: every command position gets a user value", () => {
  it("omitted and trailing-empty positions are written as empty user values", () => {
    expect(p("VEH.ABC123..").userValues).toEqual({ plate: "ABC123", state: "", year: "", vin: "" });
  });
  it("a bare command code writes every position empty", () => {
    expect(p("veh").userValues).toEqual({ plate: "", state: "", year: "", vin: "" });
  });
  it("an omitted rest position is written empty", () => {
    expect(p("PRO.ZZ-0001.GUN").userValues).toEqual({
      serial: "ZZ-0001",
      propertyType: "GUN",
      description: "",
    });
  });
  it("a whitespace-blank rest remainder is written empty", () => {
    expect(p("PRO.ZZ-0001.GUN.  ").userValues.description).toBe("");
  });
  it("a named token for an omitted positioned field is not overwritten", () => {
    expect(p("VEH.ZZ-0001.year=26").userValues).toEqual({
      plate: "ZZ-0001",
      state: "",
      year: "26",
      vin: "",
    });
  });
});

describe("spec 4.4 error params never carry the typed value", () => {
  const inputs = [
    "",
    "   ",
    "ZZTOP",
    "XYZ.ZZ-0001",
    "VEH.ZZ-0001.AZ.26",
    "VEH.ZZ-0001.QQ",
    "VEH.ZZ-0001.OK",
    "VEH.ZZ-0001.TX.plateType=PC",
    "VEH.ZZ-0001.OK.plateType=QQQ",
    "VEH.ZZ-0001.QQ.26.V1.EXTRA",
    "VEH.ZZ-00011111111.OK",
    "VEH.ZZ-0001.OK.plateTyp=PC",
    "VEH.ZZ-0001.plateType=PC.ORPHAN",
    "VEH.ZZ-0001.state=OK.state=AZ",
    "VEH.ZZ-0001.ABCD",
    "PER..PAT",
    "PER.TESTLAST.PAT.13131901.QQ",
    "PER.TESTLAST.PAT.99999999",
    "PRO.ZZ-0001.NOPE.a.b.c",
    "WNT..PAT.1901-13-01",
  ];
  const exempt = new Set(["terminal.unknownCommand:code", "terminal.unknownField:name"]);
  // every token, the command code included (exempt covers unknownCommand:code), and the whole input
  const typedValues = (input: string): string[] =>
    [
      input,
      ...input
        .split(".")
        // a named token's key is a field key, not a typed value
        .flatMap((t) => [t, t.slice(t.indexOf("=") + 1)]),
    ]
      .map((t) => t.trim())
      .filter((t) => t !== "");

  it("the typed list includes the command-code token and the whole trimmed input", () => {
    const typed = typedValues(" ZZTOP ");
    expect(typed).toContain("ZZTOP");
    expect(typedValues("XYZ.ZZ-0001")).toEqual(
      expect.arrayContaining(["XYZ", "XYZ.ZZ-0001", "ZZ-0001"]),
    );
  });

  it.each(inputs.map((input, i) => [i + 1, input] as const))("input %i", (_, input) => {
    const r = p(input);
    expect(r.errors.length).toBeGreaterThan(0);
    const typed = typedValues(input);
    for (const e of r.errors) {
      for (const [name, value] of Object.entries(e.params ?? {})) {
        if (exempt.has(`${e.key}:${name}`)) continue;
        expect(typed).not.toContain(String(value));
      }
    }
  });
});

describe("terminal index", () => {
  it("re-exports parseCommand", () => {
    expect(terminal.parseCommand).toBe(parseCommand);
  });
});
