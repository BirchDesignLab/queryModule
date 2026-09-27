import type { Condition, Diagnostic, QueryType } from "../config/index.js";

/** Leaf field keys read by a condition; `$default` references are not reads. */
export function conditionFields(condition: Condition): string[] {
  if ("all" in condition) return condition.all.flatMap(conditionFields);
  if ("any" in condition) return condition.any.flatMap(conditionFields);
  if ("not" in condition) return conditionFields(condition.not);
  return [condition.field];
}

/**
 * Spec 4.1 and 4.3 rule-set guarantees: no cycle among setDefault dependencies (an edge runs from
 * each field a setDefault condition reads to its target) and no rule reading a field whose
 * setDefault appears later in `rules`. Together they make the single pass equal a fixed point.
 * Also no setDefault on a picklist filter parent (decision 09-27-26).
 */
export function validateRuleGraph(queryType: QueryType, basePath: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const edges = new Map<string, Set<string>>();
  for (const rule of queryType.rules) {
    if (rule.effect !== "setDefault") continue;
    for (const from of conditionFields(rule.when)) {
      const targets = edges.get(from) ?? new Set<string>();
      targets.add(rule.field);
      edges.set(from, targets);
    }
  }
  const reachableFrom = (start: string): Set<string> => {
    const seen = new Set<string>([start]);
    const stack = [start];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      for (const next of edges.get(node) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return seen;
  };
  queryType.rules.forEach((rule, index) => {
    if (rule.effect !== "setDefault") return;
    const reachable = reachableFrom(rule.field);
    if (conditionFields(rule.when).some((field) => reachable.has(field))) {
      diagnostics.push({
        level: "error",
        path: `${basePath}/rules/${index}`,
        key: "config.setDefaultCycle",
        params: { field: rule.field },
      });
    }
  });
  // Decision 09-27-26: step 2 checks a filtered child against its parent's canonical value in one
  // pass, so a parent set only by setDefault would offer options the child then rejects.
  const filterParents = new Set(
    queryType.fields.flatMap((f) => (f.picklistFilter ? [f.picklistFilter.byField] : [])),
  );
  queryType.rules.forEach((rule, index) => {
    if (rule.effect === "setDefault" && filterParents.has(rule.field)) {
      diagnostics.push({
        level: "error",
        path: `${basePath}/rules/${index}`,
        key: "config.setDefaultTargetsFilterParent",
        params: { field: rule.field },
      });
    }
  });
  queryType.rules.forEach((rule, index) => {
    for (const field of new Set(conditionFields(rule.when))) {
      const laterRule = queryType.rules.findIndex(
        (r, j) => j > index && r.effect === "setDefault" && r.field === field,
      );
      if (laterRule !== -1) {
        diagnostics.push({
          level: "error",
          path: `${basePath}/rules/${index}/when`,
          key: "config.ruleReadsLaterDefault",
          params: { field, laterRule },
        });
      }
    }
  });
  return diagnostics;
}
