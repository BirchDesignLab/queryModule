import { canonicaliseLiteral, literalCodes } from "../rules/canonical-literal";
import { isDefaultRef, walkCondition } from "./conditions";
import { type DiagnosticSink, pointer } from "./diagnostic";
import type { FieldDef, QueryType, SiteConfig } from "./schema";
import type { Condition, Literal } from "./schema-fields";

/** Every condition in a query type with its JSON pointer: sections, rules, sources, alsoRun. */
function queryTypeConditions(qt: QueryType, q: number): { cond: Condition; path: string }[] {
  const base = pointer("queryTypes", q);
  const found: { cond: Condition; path: string }[] = [];
  qt.sections.forEach((s, i) => {
    if (s.when) found.push({ cond: s.when, path: `${base}/sections/${i}/when` });
  });
  qt.rules.forEach((r, i) => {
    found.push({ cond: r.when, path: `${base}/rules/${i}/when` });
  });
  qt.sources.forEach((s, i) => {
    if (s.when) found.push({ cond: s.when, path: `${base}/sources/${i}/when` });
  });
  (qt.alsoRun ?? []).forEach((n, i) => {
    if (n.when) found.push({ cond: n.when, path: `${base}/alsoRun/${i}/when` });
  });
  return found;
}

/**
 * Visit every literal a condition compares a field with (a $default reference is not a literal),
 * with the value's JSON pointer. A field the query type lacks is skipped: the reference check
 * already reports it.
 */
export function forEachConditionLiteral(
  config: SiteConfig,
  visit: (field: FieldDef, literal: Literal, path: string) => void,
): void {
  config.queryTypes.forEach((qt, q) => {
    const byKey = new Map(qt.fields.map((f) => [f.key, f]));
    for (const { cond, path } of queryTypeConditions(qt, q)) {
      walkCondition(cond, path, (leaf, p) => {
        const def = byKey.get(leaf.field);
        if (!def || !("value" in leaf)) return;
        const value = leaf.value;
        if (Array.isArray(value)) {
          value.forEach((v, i) => {
            visit(def, v, `${p}/value/${i}`);
          });
        } else if (!isDefaultRef(value)) visit(def, value as Literal, `${p}/value`);
      });
    }
  });
}

/**
 * Spec 4.1: literals that fail canonicalisation, and a defaultValue that violates its own
 * constraints. Defaults, setDefault values and presets are checked against enabled codes;
 * condition values against all codes (a disabled code there is a warning, not an error). The
 * params carry the validation key, never the literal (spec 5.9).
 */
export function checkLiterals(config: SiteConfig, now: number, out: DiagnosticSink): void {
  const reported = new Set<string>();
  const check = (
    field: FieldDef,
    literal: Literal,
    path: string,
    scope: "all" | "enabled",
  ): void => {
    const r = canonicaliseLiteral(field, literal, {
      now,
      codes: literalCodes(config.picklists, field, scope),
    });
    const first = r.errors[0];
    if (!first) return;
    const id = `${path}\u0000${field.key}`;
    if (reported.has(id)) return;
    reported.add(id);
    out.error(path, "config.invalidLiteral", { field: field.key, key: first.key });
  };

  config.queryTypes.forEach((qt, q) => {
    const base = pointer("queryTypes", q);
    const byKey = new Map(qt.fields.map((f) => [f.key, f]));
    qt.fields.forEach((f, i) => {
      if (f.defaultValue !== undefined)
        check(f, f.defaultValue, `${base}/fields/${i}/defaultValue`, "enabled");
      else if (qt.defaults?.[f.key] === undefined) {
        const inherited = config.defaults[f.key];
        if (inherited !== undefined) check(f, inherited, pointer("defaults", f.key), "enabled");
      }
    });
    for (const [key, value] of Object.entries(qt.defaults ?? {})) {
      const f = byKey.get(key);
      if (f) check(f, value, pointer("queryTypes", q, "defaults", key), "enabled");
    }
    qt.rules.forEach((r, i) => {
      const f = byKey.get(r.field);
      if (f && r.effect === "setDefault" && r.value !== undefined)
        check(f, r.value, `${base}/rules/${i}/value`, "enabled");
    });
  });

  config.commands.forEach((c, i) => {
    const qt = config.queryTypes.find((x) => x.code === c.queryType);
    if (!qt) return;
    for (const [key, value] of Object.entries(c.presets ?? {})) {
      const f = qt.fields.find((x) => x.key === key);
      if (f) check(f, value, pointer("commands", i, "presets", key), "enabled");
    }
  });

  forEachConditionLiteral(config, (f, literal, path) => {
    check(f, literal, path, "all");
  });
}

/** Spec 4.1: require or setDefault on a hidden field that no show rule can reveal. */
export function checkReachability(config: SiteConfig, out: DiagnosticSink): void {
  config.queryTypes.forEach((qt, q) => {
    const shown = new Set(qt.rules.filter((r) => r.effect === "show").map((r) => r.field));
    qt.rules.forEach((r, i) => {
      if (r.effect !== "require" && r.effect !== "setDefault") return;
      const f = qt.fields.find((x) => x.key === r.field);
      if (f && !f.visible && !shown.has(r.field)) {
        out.error(pointer("queryTypes", q, "rules", i, "field"), "config.unreachableRuleTarget", {
          field: r.field,
          effect: r.effect,
        });
      }
    });
  });
}
