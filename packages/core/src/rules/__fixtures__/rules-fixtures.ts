import type { FieldDef } from "../../config/index.js";
import { PicklistSchema, QueryTypeSchema } from "../../config/index.js";
import type { RulesConfig } from "../types.js";

export const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

interface ConfigInput {
  defaults: Record<string, string | number | boolean>;
  picklists: unknown[];
  queryTypes: unknown[];
}

export function makeConfig(input: ConfigInput): RulesConfig {
  return {
    defaults: input.defaults,
    picklists: input.picklists.map((p) => PicklistSchema.parse(p)),
    queryTypes: input.queryTypes.map((q) => QueryTypeSchema.parse(q)),
  };
}

export function makeField(field: Record<string, unknown>): FieldDef {
  const qt = QueryTypeSchema.parse({
    code: "FIELDTEST",
    labelKey: "queryType.fieldTest",
    sections: [{ key: "base", labelKey: "section.base" }],
    fields: [{ labelKey: "field.test", ...field }],
    rules: [],
    sources: [{ sourceId: "fieldTest", selectedByDefault: true }],
  });
  const [first] = qt.fields;
  if (first === undefined) throw new Error("makeField: schema returned no field");
  return first;
}

const stateIsNotDefault = { field: "state", op: "neq", value: { $default: "state" } };

export function vehicleConfig(): RulesConfig {
  return makeConfig({
    defaults: { state: "TX" },
    picklists: [
      {
        id: "state",
        values: [
          { code: "TX", labelKey: "state.tx" },
          { code: "OK", labelKey: "state.ok" },
          { code: "NM", labelKey: "state.nm" },
          { code: "ZZ", labelKey: "state.zz", enabled: false },
        ],
      },
      {
        id: "plateType",
        values: [
          { code: "PC", labelKey: "plateType.pc" },
          { code: "TK", labelKey: "plateType.tk" },
        ],
      },
    ],
    queryTypes: [
      {
        code: "VEH",
        labelKey: "queryType.veh",
        allowPlateOnly: true,
        sections: [
          { key: "base", labelKey: "section.base" },
          { key: "expanded", labelKey: "section.expanded", when: stateIsNotDefault },
        ],
        fields: [
          {
            key: "plate",
            labelKey: "field.plate",
            dataType: "string",
            required: true,
            transform: "upper",
            maxLength: 10,
          },
          { key: "state", labelKey: "field.state", dataType: "picklist", picklist: "state" },
          { key: "year", labelKey: "field.year", dataType: "year" },
          {
            key: "vin",
            labelKey: "field.vin",
            dataType: "string",
            transform: "upper",
            maxLength: 17,
          },
          {
            key: "plateType",
            labelKey: "field.plateType",
            dataType: "picklist",
            picklist: "plateType",
            visible: false,
          },
          {
            key: "tagSticker",
            labelKey: "field.tagSticker",
            dataType: "string",
            section: "expanded",
            custom: true,
          },
        ],
        rules: [
          { field: "plateType", when: stateIsNotDefault, effect: "show" },
          { field: "plateType", when: stateIsNotDefault, effect: "require" },
        ],
        sources: [
          { sourceId: "stateDb", selectedByDefault: true, plateOnly: true },
          { sourceId: "nationalDb", selectedByDefault: true },
        ],
      },
    ],
  });
}

const isFirearm = { field: "propertyType", op: "eq", value: "firearm" };

export function propertyConfig(): RulesConfig {
  return makeConfig({
    defaults: {},
    picklists: [
      {
        id: "propertyType",
        values: [
          { code: "FIREARM", labelKey: "propertyType.firearm" },
          { code: "ELECTRONICS", labelKey: "propertyType.electronics" },
          { code: "BOAT", labelKey: "propertyType.boat", enabled: false },
        ],
      },
      {
        id: "propertyKind",
        values: [
          { code: "HANDGUN", labelKey: "propertyKind.handgun", parent: "FIREARM" },
          { code: "RIFLE", labelKey: "propertyKind.rifle", parent: "FIREARM" },
          { code: "LAPTOP", labelKey: "propertyKind.laptop", parent: "ELECTRONICS" },
          { code: "PHONE", labelKey: "propertyKind.phone", parent: "ELECTRONICS" },
          { code: "KAYAK", labelKey: "propertyKind.kayak", parent: "BOAT" },
        ],
      },
    ],
    queryTypes: [
      {
        code: "PRO",
        labelKey: "queryType.pro",
        sections: [
          { key: "base", labelKey: "section.base" },
          { key: "firearm", labelKey: "section.firearm", when: isFirearm },
        ],
        fields: [
          { key: "serial", labelKey: "field.serial", dataType: "string", transform: "upper" },
          {
            key: "propertyKind",
            labelKey: "field.propertyKind",
            dataType: "picklist",
            picklist: "propertyKind",
            role: "type",
            picklistFilter: { byField: "propertyType" },
          },
          {
            key: "propertyType",
            labelKey: "field.propertyType",
            dataType: "picklist",
            picklist: "propertyType",
            role: "type",
            required: true,
          },
          {
            key: "description",
            labelKey: "field.description",
            dataType: "string",
            charset: "printable",
            maxLength: 200,
          },
          { key: "caliber", labelKey: "field.caliber", dataType: "string", section: "firearm" },
        ],
        rules: [
          { field: "caliber", when: isFirearm, effect: "require" },
          {
            field: "serial",
            when: { field: "propertyType", op: "in", value: ["FIREARM"] },
            effect: "require",
          },
        ],
        sources: [{ sourceId: "nationalDb", selectedByDefault: true }],
      },
    ],
  });
}

export function ruleTestConfig(): RulesConfig {
  return makeConfig({
    defaults: { unit: "Z9", agency: "bdl" },
    picklists: [
      {
        id: "mode",
        values: [
          { code: "ROUTINE", labelKey: "mode.routine" },
          { code: "URGENT", labelKey: "mode.urgent" },
        ],
      },
    ],
    queryTypes: [
      {
        code: "TST",
        labelKey: "queryType.tst",
        defaults: { unit: "A1" },
        sections: [
          { key: "base", labelKey: "section.base" },
          {
            key: "extra",
            labelKey: "section.extra",
            when: { field: "mode", op: "eq", value: "URGENT" },
          },
        ],
        fields: [
          { key: "mode", labelKey: "field.mode", dataType: "picklist", picklist: "mode" },
          { key: "unit", labelKey: "field.unit", dataType: "string", transform: "upper" },
          { key: "agency", labelKey: "field.agency", dataType: "string" },
          { key: "count", labelKey: "field.count", dataType: "number" },
          {
            key: "priority",
            labelKey: "field.priority",
            dataType: "string",
            transform: "upper",
            defaultValue: "low",
          },
          { key: "note", labelKey: "field.note", dataType: "string", charset: "printable" },
          { key: "flag", labelKey: "field.flag", dataType: "boolean" },
          { key: "when", labelKey: "field.when", dataType: "date" },
          { key: "extraInfo", labelKey: "field.extraInfo", dataType: "string", section: "extra" },
        ],
        rules: [
          {
            field: "priority",
            when: { field: "mode", op: "eq", value: "urgent" },
            effect: "setDefault",
            value: "high",
          },
          {
            field: "priority",
            when: { field: "count", op: "gte", value: 10 },
            effect: "setDefault",
            value: "critical",
          },
          {
            field: "note",
            when: { field: "priority", op: "neq", value: { $default: "priority" } },
            effect: "require",
          },
          { field: "note", when: { field: "unit", op: "eq", value: "quiet" }, effect: "hide" },
          { field: "note", when: { field: "flag", op: "eq", value: true }, effect: "show" },
        ],
        sources: [
          { sourceId: "alpha", selectedByDefault: true },
          {
            sourceId: "beta",
            selectedByDefault: false,
            when: { field: "unit", op: "eq", value: "b2" },
          },
        ],
      },
    ],
  });
}

/** Two picklist fields that filter each other; validation rejects this, the engine must not hang. */
export function cyclicPicklistConfig(): RulesConfig {
  return makeConfig({
    defaults: {},
    picklists: [
      { id: "p", values: [{ code: "A", labelKey: "p.a" }] },
      { id: "q", values: [{ code: "B", labelKey: "q.b" }] },
    ],
    queryTypes: [
      {
        code: "CYC",
        labelKey: "queryType.cyc",
        sections: [{ key: "base", labelKey: "section.base" }],
        fields: [
          {
            key: "left",
            labelKey: "field.left",
            dataType: "picklist",
            picklist: "p",
            picklistFilter: { byField: "right" },
          },
          {
            key: "right",
            labelKey: "field.right",
            dataType: "picklist",
            picklist: "q",
            picklistFilter: { byField: "left" },
          },
        ],
        rules: [],
        sources: [{ sourceId: "cyc", selectedByDefault: true }],
      },
    ],
  });
}
