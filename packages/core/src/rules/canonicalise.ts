import type { FieldDef } from "../config/index.js";
import type { ValidationError } from "../contracts/index.js";
import { parseDate, resolveYear } from "./dates.js";
import type { CanonicalValue, RawValue } from "./types.js";

export interface CanonContext {
  now: number;
  /** Picklist only: the codes the value may match (enabled, after picklistFilter). */
  codes?: readonly string[];
}

export interface CanonResult {
  value: CanonicalValue | null;
  errors: ValidationError[];
}

export const ISO_DATE_FORMAT = "YYYY-MM-DD";

const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const INTEGER = /^-?\d+$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const TRUE_TOKENS = new Set(["Y", "1", "TRUE"]);
const FALSE_TOKENS = new Set(["N", "0", "FALSE"]);

type Params = Record<string, string | number | boolean>;

export function rawText(raw: RawValue): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

export function isRawEmpty(raw: RawValue): boolean {
  return rawText(raw) === "";
}

function invalid(key: string, field: string, extra: Params = {}): CanonResult {
  return { value: null, errors: [{ key, params: { field, ...extra } }] };
}

function valid(value: CanonicalValue): CanonResult {
  return { value, errors: [] };
}

function canonString(field: FieldDef, text: string): CanonResult {
  const collapsed = text.replace(/\s+/gu, " ");
  const value = field.transform === "upper" ? collapsed.toUpperCase() : collapsed;
  const errors: ValidationError[] = [];
  const charsetOk =
    field.charset === "printable" ? !CONTROL_OR_FORMAT.test(value) : PRINTABLE_ASCII.test(value);
  if (!charsetOk) errors.push({ key: "validation.invalidCharacter", params: { field: field.key } });
  const length = [...value].length;
  if (field.minLength !== undefined && length < field.minLength) {
    errors.push({ key: "validation.tooShort", params: { field: field.key, min: field.minLength } });
  }
  if (length > field.maxLength)
    errors.push({ key: "validation.tooLong", params: { field: field.key, max: field.maxLength } });
  if (field.pattern !== undefined && !new RegExp(`^(?:${field.pattern})$`, "u").test(value)) {
    errors.push({ key: "validation.patternMismatch", params: { field: field.key } });
  }
  return errors.length > 0 ? { value: null, errors } : valid(value);
}

function canonPicklist(field: FieldDef, text: string, codes: readonly string[]): CanonResult {
  const folded = text.toUpperCase();
  const code = codes.find((c) => c.toUpperCase() === folded);
  return code === undefined ? invalid("validation.notInPicklist", field.key) : valid(code);
}

function canonNumber(field: FieldDef, text: string): CanonResult {
  const decimal = field.numberKind === "decimal";
  if (!(decimal ? DECIMAL : INTEGER).test(text))
    return invalid("validation.invalidNumber", field.key);
  const parsed = Number(text);
  const value = parsed === 0 ? 0 : parsed;
  // A canonical number must survive its own string form; that keeps canon idempotent.
  const plain = decimal ? DECIMAL.test(String(value)) : Number.isSafeInteger(value);
  return plain ? valid(value) : invalid("validation.invalidNumber", field.key);
}

function canonDate(field: FieldDef, text: string, now: number): CanonResult {
  for (const format of [...field.inputFormats, ISO_DATE_FORMAT]) {
    const iso = parseDate(text, format, field.century, now);
    if (iso !== null) return valid(iso);
  }
  return invalid("validation.invalidDate", field.key);
}

function canonBoolean(field: FieldDef, text: string): CanonResult {
  const upper = text.toUpperCase();
  if (TRUE_TOKENS.has(upper)) return valid(true);
  if (FALSE_TOKENS.has(upper)) return valid(false);
  return invalid("validation.invalidBoolean", field.key);
}

/** Spec 4.3 step 2: identical for form and terminal input. */
export function canonicalise(field: FieldDef, raw: RawValue, ctx: CanonContext): CanonResult {
  const text = rawText(raw);
  if (text === "") return { value: null, errors: [] };
  switch (field.dataType) {
    case "string":
      return canonString(field, text);
    case "picklist":
      return canonPicklist(field, text, ctx.codes ?? []);
    case "number":
      return canonNumber(field, text);
    case "year": {
      const year = resolveYear(text, field.century, ctx.now);
      return year === null ? invalid("validation.invalidYear", field.key) : valid(year);
    }
    case "date":
      return canonDate(field, text, ctx.now);
    case "boolean":
      return canonBoolean(field, text);
  }
}
