import type { ValidationError } from "../contracts/index.js";
import { canonicalise } from "./canonicalise.js";
import type { CompiledField, CompiledQueryType, PicklistValue } from "./compile.js";
import { evaluateCondition, type ValueGetter } from "./conditions.js";
import type { CanonicalValue, FormInput } from "./types.js";

export interface UserValueResult {
  userValues: Map<string, CanonicalValue | null>;
  errorsByField: Map<string, ValidationError[]>;
}

/** Enabled options; with picklistFilter, only values whose parent equals the parent's value. */
export function optionsFor(
  field: CompiledField,
  parentValue: CanonicalValue | null,
): PicklistValue[] {
  if (field.def.picklistFilter === undefined) return [...field.enabledValues];
  return field.enabledValues.filter((v) => (v.parent ?? null) === parentValue);
}

/** Spec 4.3 step 2. A filter sees its parent's user value, else its configured default. */
export function computeUserValues(
  qt: CompiledQueryType,
  input: FormInput,
  now: number,
): UserValueResult {
  const userValues = new Map<string, CanonicalValue | null>();
  const errorsByField = new Map<string, ValidationError[]>();
  for (const key of qt.canonOrder) {
    const field = qt.fieldByKey.get(key);
    if (field === undefined) continue;
    let codes: readonly string[] | undefined;
    if (field.def.dataType === "picklist") {
      const parentKey = field.def.picklistFilter?.byField;
      const parent = parentKey === undefined ? undefined : qt.fieldByKey.get(parentKey);
      const parentValue =
        parent === undefined ? null : (userValues.get(parent.def.key) ?? parent.configuredDefault);
      codes = optionsFor(field, parentValue).map((v) => v.code);
    }
    const result = canonicalise(
      field.def,
      input[key],
      codes === undefined ? { now } : { now, codes },
    );
    userValues.set(key, result.value);
    if (result.errors.length > 0) errorsByField.set(key, result.errors);
  }
  return { userValues, errorsByField };
}

/** Spec 4.3 step 3: user value ?? configured default, then setDefault rules in config order. */
export function computeEffectiveValues(
  qt: CompiledQueryType,
  userValues: ReadonlyMap<string, CanonicalValue | null>,
): Map<string, CanonicalValue | null> {
  const effective = new Map<string, CanonicalValue | null>();
  for (const field of qt.fields)
    effective.set(field.def.key, userValues.get(field.def.key) ?? field.configuredDefault);
  const get: ValueGetter = (key) => effective.get(key) ?? null;
  for (const rule of qt.rules) {
    if (rule.effect !== "setDefault" || !effective.has(rule.field)) continue;
    if ((userValues.get(rule.field) ?? null) !== null) continue;
    if (evaluateCondition(rule.when, get)) effective.set(rule.field, rule.value);
  }
  return effective;
}
