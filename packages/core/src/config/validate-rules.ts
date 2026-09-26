import { TypePicklistCodeSchema } from "../contracts/primitives";
import { configuredDefault } from "./defaults";
import { type DiagnosticSink, pointer } from "./diagnostic";
import type { SiteConfig } from "./schema";
import { MAX_ALSO_RUN, MAX_VALUE_LENGTH } from "./schema-fields";
import { resolveShortcuts, strokesCollide, usLayoutChar } from "./shortcuts";

export const MAX_SOURCES_PER_SUBMIT = 8;
/** Exactly one printable non-alphanumeric ASCII character, not "=" and not space. */
export const DELIMITER_PATTERN = /^[!-/:-<>-@[-`{-~]$/;

function compiles(pattern: string): boolean {
  try {
    new RegExp(`^(?:${pattern})$`, "u");
    return true;
  } catch {
    return false;
  }
}

export function checkFieldDefs(config: SiteConfig, out: DiagnosticSink): void {
  config.queryTypes.forEach((qt, q) => {
    const base = pointer("queryTypes", q);
    if (!qt.sections.some((s) => s.key === "base"))
      out.error(`${base}/sections`, "config.missingBaseSection");
    const byKey = new Map(qt.fields.map((f) => [f.key, f]));
    qt.fields.forEach((f, i) => {
      const p = `${base}/fields/${i}`;
      const isPicklist = f.dataType === "picklist";
      if (isPicklist && f.picklist === undefined)
        out.error(`${p}/picklist`, "config.picklistRequired", { field: f.key });
      if (!isPicklist && f.picklist !== undefined)
        out.error(`${p}/picklist`, "config.picklistNotAllowed", { field: f.key });
      if (!isPicklist && f.role === "type")
        out.error(`${p}/role`, "config.typeRoleOnNonPicklist", { field: f.key });
      if (isPicklist && f.role === "type" && f.picklist !== undefined) {
        const idx = config.picklists.findIndex((pl) => pl.id === f.picklist);
        config.picklists[idx]?.values.forEach((v, j) => {
          if (!TypePicklistCodeSchema.safeParse(v.code).success) {
            out.error(
              pointer("picklists", idx, "values", j, "code"),
              "config.invalidTypePicklistCode",
              {
                code: v.code,
              },
            );
          }
        });
      }
      if (f.picklistFilter) {
        if (!isPicklist)
          out.error(`${p}/picklistFilter`, "config.picklistFilterOnNonPicklist", { field: f.key });
        const parent = byKey.get(f.picklistFilter.byField);
        if (parent && parent.dataType !== "picklist") {
          out.error(`${p}/picklistFilter/byField`, "config.byFieldNotPicklist", {
            field: parent.key,
          });
        }
        if (parent?.picklist !== undefined && f.picklist !== undefined && parent.key !== f.key) {
          const parentCodes = new Set(
            config.picklists.find((pl) => pl.id === parent.picklist)?.values.map((v) => v.code) ??
              [],
          );
          const idx = config.picklists.findIndex((pl) => pl.id === f.picklist);
          config.picklists[idx]?.values.forEach((v, j) => {
            if (v.parent !== undefined && !parentCodes.has(v.parent)) {
              out.error(pointer("picklists", idx, "values", j, "parent"), "config.unknownParent", {
                parent: v.parent,
              });
            }
          });
        }
      }
      if (f.minLength !== undefined && f.minLength > f.maxLength)
        out.error(`${p}/minLength`, "config.minAboveMax", { field: f.key });
      if (f.maxLength > MAX_VALUE_LENGTH)
        out.error(`${p}/maxLength`, "config.maxLengthTooLarge", { max: MAX_VALUE_LENGTH });
      if (f.pattern !== undefined && !compiles(f.pattern))
        out.error(`${p}/pattern`, "config.invalidPattern", { field: f.key });
    });
    // A cycle is reported once, at its lowest-index member; a field that only leads into a cycle
    // is not a member and reports nothing.
    const indexOf = new Map(qt.fields.map((f, i) => [f.key, i] as const));
    qt.fields.forEach((f, i) => {
      const members = new Set<string>();
      let cur = f;
      while (cur.picklistFilter) {
        members.add(cur.key);
        const next = byKey.get(cur.picklistFilter.byField);
        if (!next) break;
        if (next.key === f.key) {
          const first = Math.min(...[...members].map((k) => indexOf.get(k) ?? i));
          if (first === i) {
            out.error(`${base}/fields/${i}/picklistFilter`, "config.picklistFilterCycle", {
              field: f.key,
            });
          }
          break;
        }
        if (members.has(next.key)) break;
        cur = next;
      }
    });
    qt.rules.forEach((r, i) => {
      if ((r.effect === "setDefault") !== (r.value !== undefined)) {
        out.error(`${base}/rules/${i}/value`, "config.ruleValueMismatch", { effect: r.effect });
      }
    });
    if (qt.allowPlateOnly && (!byKey.has("plate") || !qt.sources.some((s) => s.plateOnly))) {
      out.error(`${base}/allowPlateOnly`, "config.plateOnlyUnsupported");
    }
    const alsoRun = qt.alsoRun ?? [];
    if (alsoRun.length > MAX_ALSO_RUN)
      out.error(`${base}/alsoRun`, "config.tooManyAlsoRun", { max: MAX_ALSO_RUN });
    alsoRun.forEach((n, i) => {
      const nested = config.queryTypes.find((x) => x.code === n.queryType);
      if (nested?.alsoRun?.length)
        out.error(`${base}/alsoRun/${i}/queryType`, "config.nestedAlsoRun", {
          queryType: n.queryType,
        });
    });
  });
}

export function checkCommands(config: SiteConfig, out: DiagnosticSink): void {
  const delimiter = config.terminal.delimiter;
  config.commands.forEach((c, i) => {
    const p = pointer("commands", i);
    if (c.code.includes(delimiter)) {
      out.error(`${p}/code`, "config.commandCodeContainsDelimiter", { delimiter });
    }
    const qt = config.queryTypes.find((q) => q.code === c.queryType);
    if (!qt) return;
    const byKey = new Map(qt.fields.map((f) => [f.key, f]));
    const positioned = new Set<string>();
    c.positions.forEach((pos, j) => {
      const field = typeof pos === "string" ? pos : pos.field;
      positioned.add(field);
      const def = byKey.get(field);
      if (typeof pos !== "string") {
        if (j !== c.positions.length - 1)
          out.error(`${p}/positions/${j}`, "config.restNotLast", { field });
        if (def && def.dataType !== "string")
          out.error(`${p}/positions/${j}`, "config.restNotString", { field });
      }
      if (
        def?.dataType === "number" &&
        def.numberKind === "decimal" &&
        config.terminal.delimiter === "."
      ) {
        out.error(`${p}/positions/${j}`, "config.decimalWithDotDelimiter", { field });
      }
    });
    const presets = c.presets ?? {};
    for (const key of Object.keys(presets)) {
      if (positioned.has(key))
        out.error(`${p}/presets/${key}`, "config.presetAndPositioned", { field: key });
    }
    for (const f of qt.fields) {
      if (
        f.required &&
        !positioned.has(f.key) &&
        !(f.key in presets) &&
        configuredDefault(config, qt, f.key) === undefined
      ) {
        out.error(`${p}/positions`, "config.requiredWithoutPosition", { field: f.key });
      }
    }
  });
}

export function checkTerminal(config: SiteConfig, out: DiagnosticSink): void {
  const d = config.terminal.delimiter;
  if (!DELIMITER_PATTERN.test(d))
    out.error("/terminal/delimiter", "config.invalidDelimiter", { delimiter: d });
  config.queryTypes.forEach((qt, q) => {
    qt.fields.forEach((f, i) => {
      if (f.dataType !== "date") return;
      const p = pointer("queryTypes", q, "fields", i);
      if (f.inputFormats.some((fmt) => fmt.includes(d)))
        out.error(`${p}/inputFormats`, "config.delimiterInDateFormat", { field: f.key });
      if (f.outputFormat.includes(d))
        out.error(`${p}/outputFormat`, "config.delimiterInDateFormat", { field: f.key });
    });
  });
  for (const [action, bindings] of Object.entries(resolveShortcuts(config.shortcuts))) {
    if (bindings.some((b) => usLayoutChar(b.keys) === d)) {
      const path = config.shortcuts?.[action]
        ? pointer("shortcuts", action)
        : "/terminal/delimiter";
      out.error(path, "config.delimiterShortcutCollision", { action });
    }
  }
}

export function checkShortcuts(config: SiteConfig, out: DiagnosticSink): void {
  const all = Object.entries(resolveShortcuts(config.shortcuts)).flatMap(([action, bs]) =>
    bs.map((b) => ({ action, ...b })),
  );
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (!a || !b) continue;
      const shared = a.context === b.context || a.context === "global" || b.context === "global";
      if (!shared || !strokesCollide(a.keys, b.keys)) continue;
      const path = config.shortcuts?.[b.action]
        ? pointer("shortcuts", b.action)
        : config.shortcuts?.[a.action]
          ? pointer("shortcuts", a.action)
          : "/shortcuts";
      out.error(path, "config.shortcutCollision", { action: b.action, other: a.action });
    }
  }
}

export function checkLimits(config: SiteConfig, out: DiagnosticSink): void {
  const seen = new Set<string>();
  config.responseMappings.forEach((m, i) => {
    const k = JSON.stringify([
      m.queryType,
      m.sourceId ?? null,
      m.persona ?? null,
      m.when !== undefined,
    ]);
    if (seen.has(k))
      out.error(pointer("responseMappings", i), "config.duplicateMapping", { id: m.id });
    seen.add(k);
  });
  config.keywords.forEach((k, i) => {
    (k.except ?? []).forEach((phrase, j) => {
      if (!phrase.toUpperCase().includes(k.keyword.toUpperCase())) {
        out.error(pointer("keywords", i, "except", j), "config.exceptWithoutKeyword", {
          keyword: k.keyword,
        });
      }
    });
  });
  config.delegation.purposes.forEach((p, i) => {
    if (
      p.maxDurationMinutes !== undefined &&
      p.maxDurationMinutes > config.delegation.maxDurationMinutes
    ) {
      out.error(
        pointer("delegation", "purposes", i, "maxDurationMinutes"),
        "config.purposeDurationTooLong",
        {
          max: config.delegation.maxDurationMinutes,
        },
      );
    }
  });
  for (const key of ["payloadDays", "valuesDays"] as const) {
    const v = config.retention[key];
    if (v !== null && v <= 0) out.error(pointer("retention", key), "config.retentionNotPositive");
  }
}

export function checkWarnings(config: SiteConfig, out: DiagnosticSink): void {
  const fieldKeys = new Set(config.queryTypes.flatMap((q) => q.fields.map((f) => f.key)));
  for (const key of Object.keys(config.defaults)) {
    if (!fieldKeys.has(key))
      out.warn(pointer("defaults", key), "config.unusedSiteDefault", { field: key });
  }
  config.queryTypes.forEach((qt, q) => {
    let total = qt.sources.length;
    for (const n of qt.alsoRun ?? [])
      total += config.queryTypes.find((x) => x.code === n.queryType)?.sources.length ?? 0;
    if (total > MAX_SOURCES_PER_SUBMIT)
      out.warn(pointer("queryTypes", q), "config.tooManySourcesPossible", {
        max: MAX_SOURCES_PER_SUBMIT,
      });
  });
}
