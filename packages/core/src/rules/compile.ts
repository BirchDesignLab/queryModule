import type { Condition, FieldDef, Literal, Picklist, QueryType } from "../config/index.js";
import { canonicaliseLiteral } from "./canonical-literal.js";
import { canonicalise } from "./canonicalise.js";
import type { CanonicalValue, RulesConfig } from "./types.js";

export type CompareOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

export type CompiledCondition =
  | { kind: "compare"; field: string; op: CompareOp; value: CanonicalValue | null }
  | { kind: "member"; field: string; op: "in" | "notIn"; values: readonly CanonicalValue[] }
  | { kind: "presence"; field: string; op: "empty" | "notEmpty" }
  | { kind: "all"; items: readonly CompiledCondition[] }
  | { kind: "any"; items: readonly CompiledCondition[] }
  | { kind: "not"; item: CompiledCondition };

export type PicklistValue = Picklist["values"][number];

export interface CompiledField {
  def: FieldDef;
  order: number;
  /** FieldDef.defaultValue ?? QueryType.defaults ?? SiteConfig.defaults, canonical, frozen (spec 4.1, 4.2). */
  configuredDefault: CanonicalValue | null;
  allCodes: readonly string[];
  enabledValues: readonly PicklistValue[];
}

export interface CompiledRule {
  index: number;
  field: string;
  effect: "show" | "hide" | "require" | "setDefault";
  when: CompiledCondition;
  value: CanonicalValue | null;
}

export interface CompiledSection {
  key: string;
  labelKey: string;
  when: CompiledCondition | null;
}

export interface CompiledSource {
  sourceId: string;
  selectedByDefault: boolean;
  plateOnly: boolean;
  when: CompiledCondition | null;
}

export interface CompiledQueryType {
  code: string;
  allowPlateOnly: boolean;
  fields: readonly CompiledField[];
  fieldByKey: ReadonlyMap<string, CompiledField>;
  sections: readonly CompiledSection[];
  rules: readonly CompiledRule[];
  sources: readonly CompiledSource[];
  /** Field keys with each picklist after its picklistFilter parent (spec 4.3 step 2). */
  canonOrder: readonly string[];
}

export function isDefaultRef(value: unknown): value is { $default: string } {
  return typeof value === "object" && value !== null && "$default" in value;
}

export function findQueryType(config: RulesConfig, code: string): QueryType | undefined {
  const folded = code.toUpperCase();
  return (
    config.queryTypes.find((q) => q.code === code) ??
    config.queryTypes.find((q) => q.code.toUpperCase() === folded)
  );
}

/**
 * Literals canonicalise with the target field's dataType (spec 4.2). Condition literals match any
 * code of the picklist (a disabled code is a validation warning); defaults and setDefault values
 * match enabled codes. A literal that fails canonicalisation compiles to null, which never equals
 * a value; validateSiteConfig rejects such literals before any client sees them.
 */
function canonLiteral(
  field: CompiledField | undefined,
  literal: Literal,
  now: number,
  scope: "all" | "enabled",
): CanonicalValue | null {
  if (field === undefined) return null;
  const codes = scope === "all" ? field.allCodes : field.enabledValues.map((v) => v.code);
  return canonicaliseLiteral(field.def, literal, { now, codes }).value;
}

export function compileCondition(
  condition: Condition,
  fields: ReadonlyMap<string, CompiledField>,
  now: number,
): CompiledCondition {
  if ("all" in condition)
    return { kind: "all", items: condition.all.map((c) => compileCondition(c, fields, now)) };
  if ("any" in condition)
    return { kind: "any", items: condition.any.map((c) => compileCondition(c, fields, now)) };
  if ("not" in condition)
    return { kind: "not", item: compileCondition(condition.not, fields, now) };
  const field = fields.get(condition.field);
  switch (condition.op) {
    case "empty":
    case "notEmpty":
      return { kind: "presence", field: condition.field, op: condition.op };
    case "in":
    case "notIn":
      return {
        kind: "member",
        field: condition.field,
        op: condition.op,
        values: condition.value
          .map((v) => canonLiteral(field, v, now, "all"))
          .filter((v): v is CanonicalValue => v !== null),
      };
    default: {
      // $default is the configured default, frozen before evaluation; setDefault never changes it.
      const value = isDefaultRef(condition.value)
        ? (fields.get(condition.value.$default)?.configuredDefault ?? null)
        : canonLiteral(field, condition.value, now, "all");
      return { kind: "compare", field: condition.field, op: condition.op, value };
    }
  }
}

function picklistFilterOrder(fields: readonly CompiledField[]): string[] {
  const byKey = new Map(fields.map((f) => [f.def.key, f]));
  const ordered: string[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const place = (field: CompiledField): void => {
    const key = field.def.key;
    if (placed.has(key) || visiting.has(key)) return;
    visiting.add(key);
    const parentKey = field.def.picklistFilter?.byField;
    const parent = parentKey === undefined ? undefined : byKey.get(parentKey);
    if (parent !== undefined) place(parent);
    visiting.delete(key);
    placed.add(key);
    ordered.push(key);
  };
  for (const field of fields) place(field);
  return ordered;
}

export function compileQueryType(
  config: RulesConfig,
  code: string,
  now: number,
): CompiledQueryType | undefined {
  const qt = findQueryType(config, code);
  if (qt === undefined) return undefined;
  const picklists = new Map(config.picklists.map((p) => [p.id, p]));
  const fields: CompiledField[] = qt.fields.map((def, order) => {
    const values = def.picklist === undefined ? [] : (picklists.get(def.picklist)?.values ?? []);
    const enabledValues = values.filter((v) => v.enabled);
    const literal = def.defaultValue ?? qt.defaults?.[def.key] ?? config.defaults[def.key];
    const configuredDefault =
      literal === undefined
        ? null
        : canonicalise(def, literal, { now, codes: enabledValues.map((v) => v.code) }).value;
    return { def, order, configuredDefault, allCodes: values.map((v) => v.code), enabledValues };
  });
  const fieldByKey = new Map(fields.map((f) => [f.def.key, f]));
  const compile = (c: Condition): CompiledCondition => compileCondition(c, fieldByKey, now);
  return {
    code: qt.code,
    allowPlateOnly: qt.allowPlateOnly,
    fields,
    fieldByKey,
    sections: qt.sections.map((s) => ({
      key: s.key,
      labelKey: s.labelKey,
      when: s.when === undefined ? null : compile(s.when),
    })),
    rules: qt.rules.map((r, index) => ({
      index,
      field: r.field,
      effect: r.effect,
      when: compile(r.when),
      value:
        r.effect === "setDefault" && r.value !== undefined
          ? canonLiteral(fieldByKey.get(r.field), r.value, now, "enabled")
          : null,
    })),
    sources: qt.sources.map((s) => ({
      sourceId: s.sourceId,
      selectedByDefault: s.selectedByDefault,
      plateOnly: s.plateOnly,
      when: s.when === undefined ? null : compile(s.when),
    })),
    canonOrder: picklistFilterOrder(fields),
  };
}
