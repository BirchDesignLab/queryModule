import { isDefaultRef, walkCondition } from "./conditions";
import { configuredDefault } from "./defaults";
import { type Diagnostic, DiagnosticSink, pointer } from "./diagnostic";
import { FEATURES } from "./features";
import { type QueryType, SEVERITIES, type SiteConfig } from "./schema";
import { type Condition, ORDERED_DATA_TYPES, ORDERING_OPS } from "./schema-fields";
import { SHORTCUT_ACTIONS } from "./shortcuts";
import { type ContrastContext, checkContrast } from "./validate-contrast";
import { checkLiterals, checkReachability } from "./validate-literals";
import {
  checkCommands,
  checkFieldDefs,
  checkLimits,
  checkShortcuts,
  checkTerminal,
  checkWarnings,
} from "./validate-rules";

export type { ContrastContext } from "./validate-contrast";
export type LocaleBundles = Readonly<Record<string, Readonly<Record<string, string>>>>;
export interface ValidateContext {
  tokenNames?: readonly string[];
  /** Adapter kinds the API's source-adapter registry supports (spec 5.8; core stays pure, so the
   *  API passes this at startup, same pattern as tokenNames). Omitted: no check (Controller
   *  ruling W3-1, Task 12). */
  adapterKinds?: readonly string[];
  /** Token contrast lookups (spec 4.1; the API and CLI pass them from the tokens package). Omitted:
   *  no contrast diagnostics. */
  contrast?: ContrastContext;
  /** Epoch ms for literal checks. Defaults to 0: only century "past" two-digit years depend on
   *  it, and 0 is safe there because it only fixes two-digit years. */
  now?: number;
}
export interface ValidateResult {
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

/** Referential pass on the resolved config (spec 4.1). Fail closed on any error. */
export function validateSiteConfig(
  config: SiteConfig,
  locales: LocaleBundles,
  context: ValidateContext = {},
): ValidateResult {
  const out = new DiagnosticSink();
  checkDuplicates(config, out);
  checkReferences(config, out, context);
  checkLabels(config, locales, out);
  checkFieldDefs(config, out);
  checkCommands(config, out);
  checkTerminal(config, out);
  checkShortcuts(config, out);
  checkLimits(config, out);
  checkWarnings(config, out);
  checkLiterals(config, context.now ?? 0, out);
  checkReachability(config, out);
  if (context.contrast) checkContrast(config, context.contrast, out);
  return out.result();
}

function checkUnique<T>(
  items: readonly T[],
  id: (t: T) => string,
  path: string,
  prop: string,
  out: DiagnosticSink,
  fold = false,
): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const raw = id(item);
    const k = fold ? raw.toLowerCase() : raw;
    if (seen.has(k)) out.error(`${path}/${i}/${prop}`, "config.duplicateKey", { key: raw });
    seen.add(k);
  });
}

function checkDuplicates(config: SiteConfig, out: DiagnosticSink): void {
  checkUnique(config.picklists, (p) => p.id, "/picklists", "id", out);
  config.picklists.forEach((p, i) => {
    checkUnique(p.values, (v) => v.code, pointer("picklists", i, "values"), "code", out);
  });
  checkUnique(config.sources, (s) => s.id, "/sources", "id", out);
  checkUnique(config.queryTypes, (q) => q.code, "/queryTypes", "code", out, true);
  checkUnique(config.commands, (c) => c.code, "/commands", "code", out, true);
  checkUnique(config.personas, (p) => p.key, "/personas", "key", out);
  checkUnique(config.keywords, (k) => k.keyword, "/keywords", "keyword", out);
  checkUnique(config.responseMappings, (m) => m.id, "/responseMappings", "id", out);
  checkUnique(config.delegation.purposes, (p) => p.key, "/delegation/purposes", "key", out);
  config.queryTypes.forEach((q, i) => {
    const base = pointer("queryTypes", i);
    checkUnique(q.fields, (f) => f.key, `${base}/fields`, "key", out);
    checkUnique(q.sections, (s) => s.key, `${base}/sections`, "key", out);
    checkUnique(q.sources, (s) => s.sourceId, `${base}/sources`, "sourceId", out);
    checkUnique(q.alsoRun ?? [], (n) => n.queryType, `${base}/alsoRun`, "queryType", out);
  });
}

/** Check a condition's field references against a query type's fields (spec 4.2). */
export function checkCondition(
  config: SiteConfig,
  qt: QueryType,
  cond: Condition,
  path: string,
  out: DiagnosticSink,
): void {
  walkCondition(cond, path, (leaf, p) => {
    const def = qt.fields.find((f) => f.key === leaf.field);
    if (!def) out.error(`${p}/field`, "config.unknownField", { field: leaf.field });
    const value = "value" in leaf ? leaf.value : undefined;
    if (isDefaultRef(value)) {
      const target = value.$default;
      if (!qt.fields.some((f) => f.key === target))
        out.error(`${p}/value/$default`, "config.unknownField", { field: target });
      else if (configuredDefault(config, qt, target) === undefined)
        out.error(`${p}/value/$default`, "config.noConfiguredDefault", { field: target });
    }
    if (def && ORDERING_OPS.has(leaf.op) && !ORDERED_DATA_TYPES.has(def.dataType)) {
      out.error(`${p}/op`, "config.orderingOnNonOrdered", { field: leaf.field });
    }
  });
}

function checkReferences(config: SiteConfig, out: DiagnosticSink, context: ValidateContext): void {
  const picklistIds = new Set(config.picklists.map((p) => p.id));
  const sourceIds = new Set(config.sources.map((s) => s.id));
  const qtByCode = new Map(config.queryTypes.map((q) => [q.code, q]));
  const personaKeys = new Set(config.personas.map((p) => p.key));

  for (const key of Object.keys(config.features)) {
    if (!(FEATURES as readonly string[]).includes(key))
      out.error(pointer("features", key), "config.unknownFeature", { feature: key });
  }

  config.queryTypes.forEach((qt, q) => {
    const base = pointer("queryTypes", q);
    const fieldKeys = new Set(qt.fields.map((f) => f.key));
    const sectionKeys = new Set(qt.sections.map((s) => s.key));
    const checkField = (field: string, path: string) => {
      if (!fieldKeys.has(field)) out.error(path, "config.unknownField", { field });
    };
    qt.fields.forEach((f, i) => {
      const p = `${base}/fields/${i}`;
      if (f.picklist !== undefined && !picklistIds.has(f.picklist))
        out.error(`${p}/picklist`, "config.unknownPicklist", { picklist: f.picklist });
      if (f.picklistFilter) checkField(f.picklistFilter.byField, `${p}/picklistFilter/byField`);
      if (!sectionKeys.has(f.section))
        out.error(`${p}/section`, "config.unknownSection", { section: f.section });
    });
    qt.sections.forEach((s, i) => {
      if (s.when) checkCondition(config, qt, s.when, `${base}/sections/${i}/when`, out);
    });
    qt.rules.forEach((r, i) => {
      checkField(r.field, `${base}/rules/${i}/field`);
      checkCondition(config, qt, r.when, `${base}/rules/${i}/when`, out);
    });
    for (const k of Object.keys(qt.defaults ?? {})) checkField(k, `${base}/defaults/${k}`);
    qt.sources.forEach((s, i) => {
      if (!sourceIds.has(s.sourceId))
        out.error(`${base}/sources/${i}/sourceId`, "config.unknownSource", {
          sourceId: s.sourceId,
        });
      if (s.when) checkCondition(config, qt, s.when, `${base}/sources/${i}/when`, out);
    });
    (qt.alsoRun ?? []).forEach((n, i) => {
      const p = `${base}/alsoRun/${i}`;
      const nested = qtByCode.get(n.queryType);
      if (!nested)
        out.error(`${p}/queryType`, "config.unknownQueryType", { queryType: n.queryType });
      for (const [target, source] of Object.entries(n.fieldMap)) {
        if (nested && !nested.fields.some((f) => f.key === target))
          out.error(pointer(...p.slice(1).split("/"), "fieldMap", target), "config.unknownField", {
            field: target,
          });
        checkField(source, pointer(...p.slice(1).split("/"), "fieldMap", target));
      }
      if (n.when) checkCondition(config, qt, n.when, `${p}/when`, out);
    });
  });

  config.commands.forEach((c, i) => {
    const p = pointer("commands", i);
    const qt = qtByCode.get(c.queryType);
    if (!qt) {
      out.error(`${p}/queryType`, "config.unknownQueryType", { queryType: c.queryType });
      return;
    }
    const keys = new Set(qt.fields.map((f) => f.key));
    c.positions.forEach((pos, j) => {
      const field = typeof pos === "string" ? pos : pos.field;
      if (!keys.has(field)) out.error(`${p}/positions/${j}`, "config.unknownField", { field });
    });
    for (const k of Object.keys(c.presets ?? {})) {
      if (!keys.has(k)) out.error(`${p}/presets/${k}`, "config.unknownField", { field: k });
    }
  });

  config.quickAccess.forEach((code, i) => {
    if (!qtByCode.has(code))
      out.error(pointer("quickAccess", i), "config.unknownQueryType", { queryType: code });
  });

  config.responseMappings.forEach((m, i) => {
    const p = pointer("responseMappings", i);
    const qt = qtByCode.get(m.queryType);
    if (!qt) out.error(`${p}/queryType`, "config.unknownQueryType", { queryType: m.queryType });
    else if (m.when) checkCondition(config, qt, m.when, `${p}/when`, out);
    if (m.sourceId !== undefined && !sourceIds.has(m.sourceId))
      out.error(`${p}/sourceId`, "config.unknownSource", { sourceId: m.sourceId });
    if (m.persona !== undefined && !personaKeys.has(m.persona))
      out.error(`${p}/persona`, "config.unknownPersona", { persona: m.persona });
  });

  if (context.tokenNames) {
    const names = new Set(context.tokenNames);
    for (const sev of SEVERITIES) {
      const style = config.keywordSeverityStyles[sev];
      for (const prop of ["color", "background"] as const) {
        if (!names.has(style[prop]))
          out.error(pointer("keywordSeverityStyles", sev, prop), "config.unknownToken", {
            token: style[prop],
          });
      }
    }
    for (const [scope, overrides] of Object.entries(config.theme?.tokens ?? {})) {
      for (const name of Object.keys(overrides ?? {})) {
        if (!names.has(name))
          out.error(pointer("theme", "tokens", scope, name), "config.unknownToken", {
            token: name,
          });
      }
    }
  }

  if (context.adapterKinds) {
    const kinds = new Set(context.adapterKinds);
    config.sources.forEach((s, i) => {
      if (!kinds.has(s.kind))
        out.error(pointer("sources", i, "kind"), "config.unknownAdapterKind", { kind: s.kind });
    });
  }

  for (const action of Object.keys(config.shortcuts ?? {})) {
    if (!(SHORTCUT_ACTIONS as readonly string[]).includes(action))
      out.error(pointer("shortcuts", action), "config.unknownAction", { action });
  }
}

/** Every labelKey in the config with its JSON pointer (spec 4.1: must exist in every listed locale). */
export function collectLabelKeys(config: SiteConfig): { labelKey: string; path: string }[] {
  const keys: { labelKey: string; path: string }[] = [
    { labelKey: config.site.labelKey, path: "/site/labelKey" },
  ];
  config.personas.forEach((p, i) => {
    keys.push({ labelKey: p.labelKey, path: pointer("personas", i, "labelKey") });
  });
  config.delegation.purposes.forEach((p, i) => {
    keys.push({ labelKey: p.labelKey, path: pointer("delegation", "purposes", i, "labelKey") });
  });
  config.picklists.forEach((pl, i) => {
    pl.values.forEach((v, j) => {
      keys.push({ labelKey: v.labelKey, path: pointer("picklists", i, "values", j, "labelKey") });
    });
  });
  config.sources.forEach((s, i) => {
    keys.push({ labelKey: s.labelKey, path: pointer("sources", i, "labelKey") });
  });
  config.queryTypes.forEach((q, i) => {
    keys.push({ labelKey: q.labelKey, path: pointer("queryTypes", i, "labelKey") });
    q.sections.forEach((s, j) => {
      keys.push({
        labelKey: s.labelKey,
        path: pointer("queryTypes", i, "sections", j, "labelKey"),
      });
    });
    q.fields.forEach((f, j) => {
      keys.push({ labelKey: f.labelKey, path: pointer("queryTypes", i, "fields", j, "labelKey") });
    });
  });
  config.responseMappings.forEach((m, i) => {
    m.elements.forEach((e, j) => {
      keys.push({
        labelKey: e.labelKey,
        path: pointer("responseMappings", i, "elements", j, "labelKey"),
      });
      if (e.kind === "table") {
        e.columns.forEach((c, k) => {
          keys.push({
            labelKey: c.labelKey,
            path: pointer("responseMappings", i, "elements", j, "columns", k, "labelKey"),
          });
        });
      }
    });
  });
  return keys;
}

function checkLabels(config: SiteConfig, locales: LocaleBundles, out: DiagnosticSink): void {
  const labels = collectLabelKeys(config);
  config.locales.forEach((locale, i) => {
    const bundle = locales[locale];
    if (!bundle) {
      out.error(pointer("locales", i), "config.missingLocale", { locale });
      return;
    }
    for (const { labelKey, path } of labels) {
      if (!(labelKey in bundle)) out.error(path, "config.missingLabel", { labelKey, locale });
    }
  });
}
