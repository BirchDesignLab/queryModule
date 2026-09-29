import { describe, expect, it } from "vitest";
import type { ValidationError } from "../contracts/index";
import { canonicalise } from "../rules/canonicalise";
import { defaultSite, exampleOkSite } from "./__fixtures__/sites";
import * as terminal from "./index";
import { parseCommand } from "./parse";
import type { TerminalConfig } from "./types";

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
  const site: TerminalConfig = {
    ...defaultSite,
    commands: [
      {
        code: "VPC",
        queryType: "VEH",
        presets: { plateType: "PC" },
        positions: ["plate", "state"],
      },
      { code: "VP", queryType: "VEH", positions: ["plate", "plateType"] },
    ],
  };
  it("a typed value for a hidden positioned field carries its position", () => {
    expect(parseCommand(site, "VP.ZZ-0001.PC", { now }).errors).toEqual([
      {
        key: "terminal.valueForHiddenField",
        params: { field: "plateType", labelKey: "field.plateType", position: 2 },
      },
    ]);
  });
  it("a preset on a hidden field is no error and stays in userValues", () => {
    const r = parseCommand(site, "VPC.ZZ-0001", { now });
    expect(r.errors).toEqual([]);
    expect(r.userValues).toEqual({ plateType: "PC", plate: "ZZ-0001", state: "" });
    expect(r.formState?.hiddenWithValue).toEqual(["plateType"]);
  });
  it("a preset on a shown field is no error either", () => {
    expect(parseCommand(site, "VPC.ZZ-0001.OK", { now }).errors).toEqual([]);
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
    "veh.zz-0001.qq.26",
    "PER..PAT",
    "PER.TESTLAST.PAT.13131901.QQ",
    "PER.TESTLAST.PAT.99999999",
    "PER.TESTLAST.PAT.01011901.QQ",
    "PER.TESTLAST.PAT.01-01-1901.X.QQ",
    "PRO.ZZ-0001.NOPE.a.b.c",
    "WNT..PAT.1901-13-01",
    "WNT.TESTLAST.PAT.1901-01-01.EXTRA",
  ];
  const exempt = new Set(["terminal.unknownCommand:code", "terminal.unknownField:name"]);
  /**
   * Every token, the command code included, and the whole trimmed input. A named token's key is a
   * field key (config), so only its value is typed.
   */
  const typedValues = (input: string): string[] => {
    const tokens = input.split(".");
    // Every suffix join too: a rest position keeps its delimiters (PRO...a.b.c gives "a.b.c").
    const suffixes = tokens.map((_, i) => tokens.slice(i).join("."));
    return [input.trim(), ...tokens.flatMap((t) => [t, t.slice(t.indexOf("=") + 1)]), ...suffixes]
      .map((t) => t.trim())
      .filter((t) => t !== "");
  };
  // Config strings: a recognised code such as PRO is a substring of field.propertyType, so a
  // field or labelKey param skips the substring check, but only when its value is one of the
  // config's own field keys or labelKeys; an exact or case-insensitive echo always fails (#323, #329).
  const configParams = new Set(["field", "labelKey"]);
  const configStrings = new Set(
    [defaultSite, exampleOkSite]
      .flatMap((s) => s.queryTypes.flatMap((q) => q.fields))
      .flatMap((f) => [f.key, f.labelKey])
      .map((s) => s.toLowerCase()),
  );
  // Canonicalised echoes: years (26 to 2026) and typed dates (to ISO YYYY-MM-DD).
  const echoFields = defaultSite.queryTypes
    .flatMap((q) => q.fields)
    .filter((f) => f.dataType === "year" || f.dataType === "date");
  const echoes = (typed: string): string[] => [
    typed,
    ...echoFields.flatMap((f) => {
      const { value } = canonicalise(f, typed, { now });
      return value === null ? [] : [String(value)];
    }),
  ];
  /**
   * `key:name` of every non-exempt param that echoes a typed value: equal ignoring case (so
   * upper-cased codes too), or containing a typed value or echo of length 3 or more.
   */
  const leaks = (input: string, errors: readonly ValidationError[]): string[] => {
    const typed = typedValues(input)
      .flatMap(echoes)
      .map((t) => t.toLowerCase());
    const echoed = (name: string, value: unknown) => {
      const text = String(value).toLowerCase();
      const substring = !(configParams.has(name) && configStrings.has(text));
      return typed.some((t) => text === t || (substring && t.length >= 3 && text.includes(t)));
    };
    return errors.flatMap((e) =>
      Object.entries(e.params ?? {})
        .filter(([name, value]) => !exempt.has(`${e.key}:${name}`) && echoed(name, value))
        .map(([name]) => `${e.key}:${name}`),
    );
  };

  it("the typed list includes the command-code token and the whole trimmed input", () => {
    const typed = typedValues(" ZZTOP ");
    expect(typed).toContain("ZZTOP");
    expect(typedValues("XYZ.ZZ-0001")).toEqual(
      expect.arrayContaining(["XYZ", "XYZ.ZZ-0001", "ZZ-0001"]),
    );
  });

  it("the check catches case-insensitive, canonical and substring echoes", () => {
    const err = (params: Record<string, string | number>): ValidationError[] => [
      { key: "validation.invalidYear", params },
    ];
    const caught = ["validation.invalidYear:echo"];
    expect(leaks("VEH.ZZ-0001.OK", err({ echo: "zz-0001" }))).toEqual(caught);
    expect(leaks("VEH.ZZ-0001.ok", err({ echo: "OK" }))).toEqual(caught);
    expect(leaks("VEH.ZZ-0001.OK.26", err({ echo: 2026 }))).toEqual(caught);
    expect(leaks("PER.TESTLAST.PAT.01-01-1901", err({ echo: "1901-01-01" }))).toEqual(caught);
    expect(leaks("PER.TESTLAST.PAT.01011901", err({ echo: "1901-01-01" }))).toEqual(caught);
    expect(leaks("PER.TESTLAST", err({ echo: "was testlast" }))).toEqual(caught);
  });

  it("config params (field, labelKey) skip only the substring check", () => {
    const params = { field: "plateType", labelKey: "field.plateType", position: 2 };
    expect(leaks("VEH.ZZ-0001.OK.plateType=PC", [{ key: "x", params }])).toEqual([]);
    const pro = { field: "propertyType", labelKey: "field.propertyType" };
    expect(leaks("PRO.ZZ-0001", [{ key: "x", params: pro }])).toEqual([]);
    // #323: a recognised command code stays typed, so an exact echo is caught in any param.
    expect(typedValues("pro.ZZ-0001")).toContain("pro");
    expect(leaks("pro.ZZ-0001", [{ key: "x", params: { echo: "PRO" } }])).toEqual(["x:echo"]);
    expect(leaks("pro.ZZ-0001", [{ key: "x", params: { field: "PRO" } }])).toEqual(["x:field"]);
    expect(leaks("VEH.ZZ-0001", [{ key: "x", params: { labelKey: "zz-0001" } }])).toEqual([
      "x:labelKey",
    ]);
  });

  it("a field or labelKey param skips the substring check only when it is a known config string (#329)", () => {
    // Built from typed text, not config: the substring echo is caught despite the param name.
    const built = { field: "x-zz-0001", labelKey: "field.zz-0001" };
    expect(leaks("VEH.ZZ-0001", [{ key: "x", params: built }])).toEqual(["x:field", "x:labelKey"]);
  });

  it("a rest remainder with delimiters is a typed value (#329)", () => {
    expect(typedValues("PRO.ZZ-0001.NOPE.a.b.c")).toEqual(expect.arrayContaining(["a.b.c"]));
    expect(leaks("PRO.ZZ-0001.NOPE.a.b.c", [{ key: "x", params: { echo: "was a.b.c" } }])).toEqual([
      "x:echo",
    ]);
  });

  it("only unknownCommand code and unknownField name are exempt (spec 4.4, #296 ruling 4)", () => {
    const code = { key: "terminal.unknownCommand", params: { code: "XYZ" } };
    const name = { key: "terminal.unknownField", params: { name: "ORPHANX" } };
    expect(leaks("XYZ.ORPHANX=1", [code, name])).toEqual([]);
    const other = { key: "terminal.unknownField", params: { code: "XYZ" } };
    expect(leaks("XYZ.ORPHANX=1", [other])).toEqual(["terminal.unknownField:code"]);
  });

  it.each(inputs.map((input, i) => [i + 1, input] as const))("input %i", (_, input) => {
    const r = p(input);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(leaks(input, r.errors)).toEqual([]);
  });
});

describe("terminal index", () => {
  it("re-exports parseCommand", () => {
    expect(terminal.parseCommand).toBe(parseCommand);
  });
});
