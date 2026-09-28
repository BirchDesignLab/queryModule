import { describe, expect, it } from "vitest";
import { defaultSite, exampleOkSite } from "./__fixtures__/sites";
import { tokenize } from "./tokenize";

const t = (input: string, c = defaultSite) => tokenize(c, input);

describe("FR-051 positions fill in order after the command code", () => {
  it("VEH.ABC123..26: plate, empty state, year", () => {
    expect(t("VEH.ABC123..26")).toEqual({
      commandCode: "VEH",
      queryType: "VEH",
      userValues: { plate: "ABC123", state: "", year: "26" },
      positionedKeys: ["plate", "state", "year"],
      presetKeys: [],
      namedKeys: [],
      errors: [],
    });
  });
  it("matches the code case-insensitively and trims values", () => {
    expect(t(" veh. ZZ-0001 .ok").userValues).toEqual({ plate: "ZZ-0001", state: "ok" });
  });
  it("ignores trailing empty tokens", () => {
    expect(t("VEH.ABC123...")).toEqual(t("VEH.ABC123"));
    expect(t("VEH.ABC123.")).toEqual(t("VEH.ABC123"));
  });
  it("a bare command code is a command with no values", () => {
    expect(t("veh")).toMatchObject({ commandCode: "VEH", userValues: {}, errors: [] });
  });
  it("uses the site delimiter", () => {
    expect(t("VEH/ABC123//26", exampleOkSite).userValues).toEqual({
      plate: "ABC123",
      state: "",
      year: "26",
    });
    // "." is not the example-ok delimiter, so the whole input is one unknown token with no delimiter.
    expect(t("VEH.ABC123", exampleOkSite).errors).toEqual([
      { key: "terminal.missingDelimiter", params: { length: 10 } },
    ]);
  });
});

describe("FR-052 named tokens and the rest position", () => {
  it("fieldKey=value sets any field, case-insensitively, after the positions", () => {
    expect(t("VEH.ABC123.OK.PLATETYPE=PC")).toMatchObject({
      userValues: { plate: "ABC123", state: "OK", plateType: "PC" },
      namedKeys: ["plateType"],
      errors: [],
    });
  });
  it("rest takes the remainder verbatim, delimiters and = included", () => {
    expect(t("PRO.S123.FIREARM.black case. strap=2").userValues.description).toBe(
      "black case. strap=2",
    );
  });
  it("a trailing empty token at the rest position is ignored (spec 4.4)", () => {
    expect(t("PRO.S123.FIREARM. ")).toEqual(t("PRO.S123.FIREARM"));
  });
  // Regression: A5 round-trip property, seeds 665939770 and 613251920 (Task 7). Empty tokens
  // before a rest position are trailing only when the rest remainder is blank too.
  it("a rest value made only of delimiters after empty positions is kept", () => {
    expect(t("PRO....")).toMatchObject({
      userValues: { serial: "", propertyType: "", description: "." },
      positionedKeys: ["serial", "propertyType", "description"],
      errors: [],
    });
    expect(t("PRO////", exampleOkSite).userValues.description).toBe("/");
    expect(t("PRO... ")).toEqual(t("PRO"));
    // After a named token the rest position is no longer read, so all later tokens are split.
    expect(t("PRO.propertyType=BOAT..")).toEqual(t("PRO.propertyType=BOAT"));
  });
  it("a positional token after a named one is an error", () => {
    expect(t("VEH.ABC123.plateType=PC.26").errors).toEqual([
      { key: "terminal.positionalAfterNamed", params: { position: 3 } },
    ]);
  });
  it("a named token for a positioned field is a duplicate", () => {
    expect(t("VEH.ABC123.plate=XYZ").errors).toEqual([
      { key: "terminal.duplicateField", params: { field: "plate", labelKey: "field.plate" } },
    ]);
  });
  it("an identifier-shaped name after a named token that is no field is unknownField (D-B2)", () => {
    expect(t("VEH.ABC123.plateType=PC.colour=RED").errors).toEqual([
      { key: "terminal.unknownField", params: { name: "colour" } },
    ]);
  });
  it("text with = that is not a field key, before any named token, stays positional", () => {
    expect(t("PER.A=B").userValues.last).toBe("A=B");
  });
});

describe("FR-051 presets set user values before positions are read", () => {
  const withPreset = {
    ...defaultSite,
    commands: [
      ...defaultSite.commands,
      { code: "VPC", queryType: "VEH", presets: { plateType: "PC" }, positions: ["plate"] },
    ],
  };
  it("a preset fills its field and is reported as preset", () => {
    expect(t("vpc.ZZ-0001", withPreset)).toEqual({
      commandCode: "VPC",
      queryType: "VEH",
      userValues: { plateType: "PC", plate: "ZZ-0001" },
      positionedKeys: ["plate"],
      presetKeys: ["plateType"],
      namedKeys: [],
      errors: [],
    });
  });
  it("a named token for a preset field is a duplicate", () => {
    expect(t("VPC.ZZ-0001.plateType=TK", withPreset).errors).toEqual([
      {
        key: "terminal.duplicateField",
        params: { field: "plateType", labelKey: "field.plateType" },
      },
    ]);
  });
});

describe("FR-055 unrecognised input", () => {
  it.each([
    ["", [{ key: "terminal.emptyInput" }]],
    ["   ", [{ key: "terminal.emptyInput" }]],
    ["XYZ.123", [{ key: "terminal.unknownCommand", params: { code: "XYZ" } }]],
    ["hello", [{ key: "terminal.missingDelimiter", params: { length: 5 } }]],
    [
      "VEH.A.TX.26.V1.extra",
      [{ key: "terminal.tooManyPositions", params: { expected: 4, got: 5 } }],
    ],
    [
      "VEH.A.TX.26.V1..extra",
      [{ key: "terminal.tooManyPositions", params: { expected: 4, got: 5 } }],
    ],
  ])("%j", (input, errors) => expect(t(input).errors).toEqual(errors));
  it("an extra token after an interior empty position is still tooManyPositions", () => {
    const r = t("VEH..A.B.C.D");
    expect(r.errors).toEqual([
      { key: "terminal.tooManyPositions", params: { expected: 4, got: 4 } },
    ]);
    expect(r.userValues).toEqual({ plate: "", state: "A", year: "B", vin: "C" });
  });
  it("returns the values it could read alongside errors", () => {
    expect(t("VEH.A.TX.26.V1.extra").userValues).toEqual({
      plate: "A",
      state: "TX",
      year: "26",
      vin: "V1",
    });
  });
});

describe("FR-051 a command whose query type is missing from the config", () => {
  const orphan = {
    ...defaultSite,
    commands: [{ code: "Q2", queryType: "NOPE", positions: ["x"] }],
  };
  it("reads positions without field lookups; named-looking text stays positional", () => {
    expect(t("Q2.x=1", orphan)).toMatchObject({
      queryType: "NOPE",
      userValues: { x: "x=1" },
      positionedKeys: ["x"],
      errors: [],
    });
  });
});
