import { z } from "zod";
import { objectFor, optionalEnum, type SchemaMode } from "./schema-mode";
import { BoundedIdSchema, FieldKeySchema } from "../contracts/primitives";

export type Literal = string | number | boolean;
export type DefaultRef = { $default: string };
export type LeafCondition =
  | { field: string; op: "eq" | "neq"; value: Literal | DefaultRef }
  | { field: string; op: "in" | "notIn"; value: Literal[] }
  | { field: string; op: "gt" | "gte" | "lt" | "lte"; value: Literal | DefaultRef }
  | { field: string; op: "empty" | "notEmpty" };
export type Condition = LeafCondition | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export const DATA_TYPES = ["string", "number", "year", "date", "boolean", "picklist"] as const;
export type DataType = (typeof DATA_TYPES)[number];
export const ORDERING_OPS: ReadonlySet<string> = new Set(["gt", "gte", "lt", "lte"]);
export const ORDERED_DATA_TYPES: ReadonlySet<DataType> = new Set(["number", "year", "date"]);
export const DEFAULT_INPUT_FORMATS = ["MMDDYYYY", "MM/DD/YYYY", "MM-DD-YYYY", "YYYY-MM-DD"] as const;
/** Tokens MM, DD, YY, YYYY and literal non-alphanumeric separators. */
export const DATE_FORMAT_PATTERN = /^(?:MM|DD|YYYY|YY|[^A-Za-z0-9])+$/;
export const MAX_VALUE_LENGTH = 4096;
export { MAX_ALSO_RUN } from "../contracts/primitives";

export function makeFieldSchemas(mode: SchemaMode) {
  const obj = objectFor(mode);
  const Key = z.string().min(1);
  const Literal = z.union([z.string(), z.number(), z.boolean()]);
  const DefaultRef = obj({ $default: Key });
  const LiteralOrDefault = z.union([Literal, DefaultRef]);

  const Condition: z.ZodType<Condition> = z.lazy(() =>
    z.union([
      obj({ field: FieldKeySchema, op: z.enum(["eq", "neq"]), value: LiteralOrDefault }),
      obj({ field: FieldKeySchema, op: z.enum(["in", "notIn"]), value: z.array(Literal) }),
      obj({ field: FieldKeySchema, op: z.enum(["gt", "gte", "lt", "lte"]), value: LiteralOrDefault }),
      obj({ field: FieldKeySchema, op: z.enum(["empty", "notEmpty"]) }),
      obj({ all: z.array(Condition) }),
      obj({ any: z.array(Condition) }),
      obj({ not: Condition }),
    ]),
  );

  const DateFormat = z.string().regex(DATE_FORMAT_PATTERN);

  const SectionDef = obj({ key: Key, labelKey: Key, when: Condition.optional() });

  const FieldDef = obj({
    key: FieldKeySchema,
    labelKey: Key,
    dataType: z.enum(DATA_TYPES),
    role: optionalEnum(mode, ["type"]),
    picklist: Key.optional(),
    picklistFilter: obj({ byField: FieldKeySchema }).optional(),
    defaultValue: Literal.optional(),
    visible: z.boolean().default(true),
    required: z.boolean().default(false),
    section: Key.default("base"),
    custom: z.boolean().default(false),
    minLength: z.int().min(0).optional(),
    maxLength: z.int().min(1).default(64),
    pattern: z.string().min(1).optional(),
    charset: z.enum(["printableAscii", "printable"]).default("printableAscii"),
    transform: z.enum(["upper", "none"]).default("none"),
    numberKind: z.enum(["integer", "decimal"]).default("integer"),
    century: z.enum(["2000", "past"]).default("2000"),
    inputFormats: z.array(DateFormat).min(1).default([...DEFAULT_INPUT_FORMATS]),
    outputFormat: DateFormat.default("MMDDYYYY"),
  });

  const FieldRule = obj({
    field: FieldKeySchema,
    when: Condition,
    effect: z.enum(["show", "hide", "require", "setDefault"]),
    value: Literal.optional(),
  });

  const QueryTypeSource = obj({
    sourceId: BoundedIdSchema,
    selectedByDefault: z.boolean(),
    plateOnly: z.boolean().default(false),
    when: Condition.optional(),
  });

  const NestedQuery = obj({
    queryType: BoundedIdSchema,
    fieldMap: z.record(FieldKeySchema, FieldKeySchema),
    when: Condition.optional(),
  });

  const QueryType = obj({
    code: BoundedIdSchema,
    labelKey: Key,
    allowPlateOnly: z.boolean().default(false),
    sections: z.array(SectionDef).min(1),
    defaults: z.record(z.string(), Literal).optional(),
    fields: z.array(FieldDef).min(1),
    rules: z.array(FieldRule).default([]),
    sources: z.array(QueryTypeSource).min(1),
    alsoRun: z.array(NestedQuery).optional(),
  });

  return { Key, Literal, DefaultRef, Condition, DateFormat, SectionDef, FieldDef, FieldRule, QueryTypeSource, NestedQuery, QueryType };
}
