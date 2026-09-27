import type { CompareOp, CompiledCondition } from "./compile.js";
import type { CanonicalValue } from "./types.js";

export type ValueGetter = (field: string) => CanonicalValue | null;

function sign(a: number | string, b: number | string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function ordered(op: "gt" | "gte" | "lt" | "lte", diff: number): boolean {
  switch (op) {
    case "gt":
      return diff > 0;
    case "gte":
      return diff >= 0;
    case "lt":
      return diff < 0;
    case "lte":
      return diff <= 0;
  }
}

/** Empty (null) is false for eq, in and ordering; true for neq and notIn (spec 4.2). */
function compare(
  op: CompareOp,
  actual: CanonicalValue | null,
  expected: CanonicalValue | null,
): boolean {
  if (actual === null) return op === "neq";
  if (op === "eq") return actual === expected;
  if (op === "neq") return actual !== expected;
  if (expected === null) return false;
  // Numeric for number and year; ISO string order for date.
  if (typeof actual === "number" && typeof expected === "number")
    return ordered(op, sign(actual, expected));
  if (typeof actual === "string" && typeof expected === "string")
    return ordered(op, sign(actual, expected));
  return false;
}

export function evaluateCondition(condition: CompiledCondition, get: ValueGetter): boolean {
  switch (condition.kind) {
    case "all":
      return condition.items.every((c) => evaluateCondition(c, get));
    case "any":
      return condition.items.some((c) => evaluateCondition(c, get));
    case "not":
      return !evaluateCondition(condition.item, get);
    case "presence": {
      const value = get(condition.field);
      return condition.op === "empty" ? value === null : value !== null;
    }
    case "member": {
      const value = get(condition.field);
      if (value === null) return condition.op === "notIn";
      const hit = condition.values.includes(value);
      return condition.op === "in" ? hit : !hit;
    }
    case "compare":
      return compare(condition.op, get(condition.field), condition.value);
  }
}
