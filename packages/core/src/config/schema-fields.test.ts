import { describe, expect, it } from "vitest";
import { makeFieldSchemas } from "./schema-fields";

const strict = makeFieldSchemas("strict");
const client = makeFieldSchemas("client");

describe("FR-002 FR-003 condition language (spec 4.2)", () => {
  it("parses leaf, $default and nested conditions", () => {
    const c = {
      all: [
        { field: "state", op: "neq", value: { $default: "state" } },
        { any: [{ field: "year", op: "gte", value: 2020 }, { not: { field: "vin", op: "empty" } }] },
        { field: "propertyType", op: "in", value: ["FIREARM", "BOAT"] },
      ],
    };
    expect(strict.Condition.parse(c)).toEqual(c);
  });
  it("rejects expression strings and unknown operators", () => {
    expect(strict.Condition.safeParse("state != 'TX'").success).toBe(false);
    expect(strict.Condition.safeParse({ field: "state", op: "like", value: "T%" }).success).toBe(false);
    expect(strict.Condition.safeParse({ field: "state", op: "in", value: "TX" }).success).toBe(false);
  });
  it("rejects a bad field key on a leaf condition (ADR-0005)", () => {
    expect(strict.Condition.safeParse({ field: "plate.no", op: "empty" }).success).toBe(false);
    expect(strict.Condition.safeParse({ field: "1plate", op: "empty" }).success).toBe(false);
  });
});

describe("FR-004 FR-008 FieldDef defaults (spec 4.1)", () => {
  it("applies every documented default", () => {
    const f = strict.FieldDef.parse({ key: "plate", labelKey: "field.plate", dataType: "string" });
    expect(f).toEqual({
      key: "plate",
      labelKey: "field.plate",
      dataType: "string",
      visible: true,
      required: false,
      section: "base",
      custom: false,
      maxLength: 64,
      charset: "printableAscii",
      transform: "none",
      numberKind: "integer",
      century: "2000",
      inputFormats: ["MMDDYYYY", "MM/DD/YYYY", "MM-DD-YYYY", "YYYY-MM-DD"],
      outputFormat: "MMDDYYYY",
    });
  });
  it("rejects an invalid date format and an unknown dataType", () => {
    expect(strict.FieldDef.safeParse({ key: "d", labelKey: "l", dataType: "date", outputFormat: "MMM DD" }).success).toBe(false);
    expect(strict.FieldDef.safeParse({ key: "d", labelKey: "l", dataType: "money" }).success).toBe(false);
  });
  it("strict mode rejects unknown keys; client mode strips them and catches optional enums", () => {
    const raw = { key: "p", labelKey: "l", dataType: "picklist", picklist: "x", role: "subtype", colour: "red" };
    expect(strict.FieldDef.safeParse(raw).success).toBe(false);
    const parsed = client.FieldDef.parse(raw);
    expect("colour" in parsed).toBe(false);
    expect(parsed.role).toBeUndefined();
  });
  it("rejects a bad field key ('plate.no', '1plate') as FieldDef.key (ADR-0005)", () => {
    expect(strict.FieldDef.safeParse({ key: "plate.no", labelKey: "l", dataType: "string" }).success).toBe(false);
    expect(strict.FieldDef.safeParse({ key: "1plate", labelKey: "l", dataType: "string" }).success).toBe(false);
  });
  it("accepts a dotted labelKey (message keys stay Key)", () => {
    expect(strict.FieldDef.safeParse({ key: "plate", labelKey: "field.plate", dataType: "string" }).success).toBe(true);
  });
  it("bounds a field key at 64 characters, rejects 65", () => {
    const key64 = "a".repeat(64);
    const key65 = "a".repeat(65);
    expect(strict.FieldDef.safeParse({ key: key64, labelKey: "l", dataType: "string" }).success).toBe(true);
    expect(strict.FieldDef.safeParse({ key: key65, labelKey: "l", dataType: "string" }).success).toBe(false);
  });
  it("rejects a bad byField key on picklistFilter (FieldKeySchema)", () => {
    expect(
      strict.FieldDef.safeParse({
        key: "make",
        labelKey: "l",
        dataType: "picklist",
        picklist: "make",
        picklistFilter: { byField: "1plate" },
      }).success,
    ).toBe(false);
  });
});

describe("FR-032 query type (spec 4.1)", () => {
  it("parses a query type with type fields, rules, sources and alsoRun", () => {
    const qt = strict.QueryType.parse({
      code: "PRO",
      labelKey: "queryType.PRO",
      sections: [{ key: "base", labelKey: "section.base" }],
      fields: [{ key: "propertyType", labelKey: "field.propertyType", dataType: "picklist", picklist: "propertyType", role: "type" }],
      rules: [{ field: "propertyType", when: { field: "propertyType", op: "notEmpty" }, effect: "require" }],
      sources: [{ sourceId: "stateSource", selectedByDefault: true }],
      alsoRun: [{ queryType: "WNT", fieldMap: { last: "last" } }],
    });
    expect(qt.allowPlateOnly).toBe(false);
    expect(qt.sources[0]?.plateOnly).toBe(false);
  });
  it("rejects a rule's field that fails FieldKeySchema", () => {
    expect(
      strict.QueryType.safeParse({
        code: "PRO",
        labelKey: "queryType.PRO",
        sections: [{ key: "base", labelKey: "section.base" }],
        fields: [{ key: "propertyType", labelKey: "field.propertyType", dataType: "string" }],
        rules: [{ field: "1bad", when: { field: "propertyType", op: "notEmpty" }, effect: "require" }],
        sources: [{ sourceId: "stateSource", selectedByDefault: true }],
      }).success,
    ).toBe(false);
  });
  it("bounds QueryType.code and QueryTypeSource.sourceId at 64/65 characters and rejects a slash", () => {
    const code64 = "P".repeat(64);
    const code65 = "P".repeat(65);
    const baseArgs = (code: string, sourceId: string) => ({
      code,
      labelKey: "queryType.PRO",
      sections: [{ key: "base", labelKey: "section.base" }],
      fields: [{ key: "propertyType", labelKey: "field.propertyType", dataType: "string" }],
      sources: [{ sourceId, selectedByDefault: true }],
    });
    expect(strict.QueryType.safeParse(baseArgs(code64, "src")).success).toBe(true);
    expect(strict.QueryType.safeParse(baseArgs(code65, "src")).success).toBe(false);
    expect(strict.QueryType.safeParse(baseArgs("PRO", "s".repeat(64))).success).toBe(true);
    expect(strict.QueryType.safeParse(baseArgs("PRO", "s".repeat(65))).success).toBe(false);
    expect(strict.QueryType.safeParse(baseArgs("PRO/1", "src")).success).toBe(false);
  });
  it("rejects a bad fieldMap key or value on alsoRun (FieldKeySchema, spec 4.6)", () => {
    const args = {
      code: "PRO",
      labelKey: "queryType.PRO",
      sections: [{ key: "base", labelKey: "section.base" }],
      fields: [{ key: "propertyType", labelKey: "field.propertyType", dataType: "string" }],
      sources: [{ sourceId: "stateSource", selectedByDefault: true }],
    };
    expect(
      strict.QueryType.safeParse({ ...args, alsoRun: [{ queryType: "WNT", fieldMap: { "1last": "last" } }] }).success,
    ).toBe(false);
    expect(
      strict.QueryType.safeParse({ ...args, alsoRun: [{ queryType: "WNT", fieldMap: { last: "1last" } }] }).success,
    ).toBe(false);
  });
});
