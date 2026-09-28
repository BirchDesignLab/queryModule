import {
  type Condition,
  type FieldDef,
  isDefaultRef,
  type Literal,
  type Picklist,
} from "../config/index.js";
import { type CanonResult, canonicalise } from "./canonicalise.js";

/**
 * Codes a literal on this field is checked against: all codes (conditions) or enabled codes
 * (defaults, setDefault, presets). Undefined for non-picklist fields. picklistFilter narrowing is
 * not applied: a literal is checked against the field's own picklist.
 */
export function literalCodes(
  picklists: readonly Picklist[],
  field: FieldDef,
  scope: "all" | "enabled",
): readonly string[] | undefined {
  if (field.dataType !== "picklist") return undefined;
  const values = picklists.find((p) => p.id === field.picklist)?.values ?? [];
  return (scope === "all" ? values : values.filter((v) => v.enabled)).map((v) => v.code);
}

/** Spec 4.2: literals are canonicalised at load with the target field's dataType. Returns the errors, unlike the compile path. */
export function canonicaliseLiteral(
  field: FieldDef,
  literal: Literal,
  o: { now: number; codes?: readonly string[] | undefined },
): CanonResult {
  return canonicalise(
    field,
    literal,
    o.codes === undefined ? { now: o.now } : { now: o.now, codes: o.codes },
  );
}

type Node = null | boolean | number | string | readonly Node[] | { readonly [k: string]: Node };

function stable(node: Node): string {
  if (node === null || typeof node !== "object") return JSON.stringify(node);
  if (Array.isArray(node)) return `[${node.map(stable).join(",")}]`;
  const obj = node as { readonly [k: string]: Node };
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(obj[k] as Node)}`).join(",")}}`;
}

/** Sorted by the stable form, duplicates removed. */
function sortedSet(nodes: readonly Node[]): Node[] {
  const byKey = new Map(nodes.map((n) => [stable(n), n]));
  return [...byKey.keys()].sort().map((k) => byKey.get(k) as Node);
}

/**
 * A stable key for a condition: literals canonicalised (a failing literal kept as {"raw": value}),
 * in/notIn values sorted and deduplicated, all/any children sorted and deduplicated, object keys sorted.
 * Two conditions with equal keys hold on exactly the same effective values.
 */
export function canonicalCondition(
  condition: Condition,
  fields: ReadonlyMap<string, FieldDef>,
  picklists: readonly Picklist[],
  now: number,
): string {
  const literal = (field: FieldDef | undefined, value: Literal): Node => {
    if (field === undefined) return { raw: value };
    const r = canonicaliseLiteral(field, value, {
      now,
      codes: literalCodes(picklists, field, "all"),
    });
    return r.value === null || r.errors.length > 0 ? { raw: value } : r.value;
  };
  const norm = (c: Condition): Node => {
    if ("all" in c) return { all: sortedSet(c.all.map(norm)) };
    if ("any" in c) return { any: sortedSet(c.any.map(norm)) };
    if ("not" in c) return { not: norm(c.not) };
    const field = fields.get(c.field);
    switch (c.op) {
      case "empty":
      case "notEmpty":
        return { field: c.field, op: c.op };
      case "in":
      case "notIn":
        return {
          field: c.field,
          op: c.op,
          value: sortedSet(c.value.map((v) => literal(field, v))),
        };
      default:
        return {
          field: c.field,
          op: c.op,
          value: isDefaultRef(c.value) ? { $default: c.value.$default } : literal(field, c.value),
        };
    }
  };
  return stable(norm(condition));
}
