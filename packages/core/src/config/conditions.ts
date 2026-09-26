import type { Condition, DefaultRef, LeafCondition } from "./schema-fields";

export function isDefaultRef(v: unknown): v is DefaultRef {
  return (
    typeof v === "object" &&
    v !== null &&
    "$default" in v &&
    typeof (v as DefaultRef).$default === "string"
  );
}

/** Visit every leaf with its JSON pointer. */
export function walkCondition(
  cond: Condition,
  path: string,
  visit: (leaf: LeafCondition, path: string) => void,
): void {
  if ("all" in cond) {
    cond.all.forEach((c, i) => {
      walkCondition(c, `${path}/all/${i}`, visit);
    });
  } else if ("any" in cond) {
    cond.any.forEach((c, i) => {
      walkCondition(c, `${path}/any/${i}`, visit);
    });
  } else if ("not" in cond) walkCondition(cond.not, `${path}/not`, visit);
  else visit(cond, path);
}
