import type { MappingElement, ResponseMapping, SiteConfig } from "../config/schema";
import type {
  MapContext,
  MappedResult,
  MappingDiagnostic,
  RenderElement,
} from "../contracts/assess";
import type { SourcePayload } from "../contracts/mock-file";
import {
  type CanonicalValue,
  compileCondition,
  compileQueryType,
  evaluateCondition,
} from "../rules";
import { formatValue } from "./format";
import { childPath, resolvePath } from "./path";

/**
 * mapResponse (spec 4.5; FR-060, UX-015, UX-016): picks the best response mapping for a part and
 * renders its elements from the raw payload; with no candidate it dumps every leaf. Pure.
 *
 * The parameter is the structural subset the mapper reads, so the browser's ClientSiteConfig fits
 * as well as SiteConfig. `defaults` and `picklists` (resolving `when` literals and `$default`) and
 * `locales` (formatting) are optional extras that both full configs carry.
 */
export type MapResponseConfig = Pick<SiteConfig, "responseMappings" | "queryTypes" | "keywords"> &
  Partial<Pick<SiteConfig, "defaults" | "picklists" | "locales">>;

const DEFAULT_LOCALE = "en-US";
/**
 * Core has no clock and MapContext carries none, so the caller passes `now` (epoch ms) for
 * canonicalising `when` literals and `$default` (spec 4.2: a two-digit year pivots on the current
 * year). Without it they canonicalise at the epoch, where 26 on a "past" field means 1926 (review C1;
 * controller ruling 10-13-26: the browser caller passes Date.now()).
 */
const NO_CLOCK = 0;

const SCORE_WHEN = 4;
const SCORE_SOURCE = 2;
const SCORE_PERSONA = 1;

function canonicalOrNull(value: unknown): CanonicalValue | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

/** Spec 4.2 against the part's effective values; false when the query type is not in the config. */
function whenHolds(
  config: MapResponseConfig,
  mapping: ResponseMapping,
  ctx: MapContext,
  condition: NonNullable<ResponseMapping["when"]>,
  now: number,
): boolean {
  const qt = compileQueryType(
    {
      defaults: config.defaults ?? {},
      picklists: config.picklists ?? [],
      queryTypes: config.queryTypes,
    },
    mapping.queryType,
    now,
  );
  if (qt === undefined) return false;
  const compiled = compileCondition(condition, qt.fieldByKey, now);
  return evaluateCondition(compiled, (field) => canonicalOrNull(ctx.partValues[field]));
}

/** Highest score wins; equal scores go to the earlier mapping in config order. */
function selectMapping(config: MapResponseConfig, ctx: MapContext, now: number): number | null {
  let best: number | null = null;
  let bestScore = -1;
  for (const [index, mapping] of config.responseMappings.entries()) {
    if (mapping.queryType !== ctx.queryType) continue;
    if (mapping.sourceId !== undefined && mapping.sourceId !== ctx.sourceId) continue;
    if (mapping.persona !== undefined && mapping.persona !== ctx.persona) continue;
    let score = 0;
    if (mapping.when !== undefined) {
      if (!whenHolds(config, mapping, ctx, mapping.when, now)) continue;
      score += SCORE_WHEN;
    }
    if (mapping.sourceId !== undefined) score += SCORE_SOURCE;
    if (mapping.persona !== undefined) score += SCORE_PERSONA;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

type Scalar = string | number | boolean;
type Format = Extract<MappingElement, { kind: "value" }>["format"];

function isScalar(value: unknown): value is Scalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

type Cell = { text: string } | { reason: "unresolved" | "not a scalar" };

/** The scalars a path yields (one array level flattened), formatted and joined with ", ". */
function cellText(source: unknown, path: string, format: Format, locale: string): Cell {
  const items = resolvePath(source, path).flatMap((v) => (Array.isArray(v) ? v : [v]));
  const scalars = items.filter(isScalar);
  if (scalars.length > 0) {
    return { text: scalars.map((s) => formatValue(s, format, locale)).join(", ") };
  }
  const hasObject = items.some((v) => typeof v === "object" && v !== null);
  return { reason: hasObject ? "not a scalar" : "unresolved" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapElement(
  element: MappingElement,
  payload: SourcePayload,
  locale: string,
  diagnostics: MappingDiagnostic[],
): RenderElement | null {
  if (element.kind === "value") {
    const cell = cellText(payload, element.path, element.format, locale);
    if ("reason" in cell) {
      diagnostics.push({ path: element.path, reason: cell.reason });
      return null;
    }
    return {
      kind: "scalar",
      label: { key: element.labelKey },
      value: cell.text,
      view: element.view,
      ...(element.format === undefined ? {} : { format: element.format }),
      highlight: element.highlight,
    };
  }
  const found = resolvePath(payload, element.path);
  if (found.length === 0) {
    diagnostics.push({ path: element.path, reason: "unresolved" });
    return null;
  }
  const records: unknown[] = found.length === 1 && Array.isArray(found[0]) ? found[0] : found;
  if (!records.every(isRecord)) {
    diagnostics.push({ path: element.path, reason: "table path is not an array of records" });
    return null;
  }
  if (records.length === 0) {
    diagnostics.push({ path: element.path, reason: "empty table" });
    return null;
  }
  return {
    kind: "table",
    label: { key: element.labelKey },
    view: element.view,
    highlight: element.highlight,
    columns: element.columns.map((c) => ({
      labelKey: c.labelKey,
      ...(c.format === undefined ? {} : { format: c.format }),
    })),
    rows: records.map((record) =>
      element.columns.map((c) => {
        const cell = cellText(record, c.path, c.format, locale);
        return "text" in cell ? cell.text : "";
      }),
    ),
  };
}

/** Every string, number and boolean leaf in payload order, labelled by its path (spec 4.5). */
function genericDump(payload: SourcePayload, locale: string): RenderElement[] {
  const out: RenderElement[] = [];
  const walk = (value: unknown, path: string): void => {
    if (isScalar(value)) {
      out.push({
        kind: "scalar",
        label: { text: path },
        value: formatValue(value, undefined, locale),
        view: "both",
        highlight: true,
      });
    } else if (Array.isArray(value)) {
      for (const [i, v] of value.entries()) walk(v, childPath(path, i));
    } else if (isRecord(value)) {
      for (const [k, v] of Object.entries(value)) walk(v, childPath(path, k));
    }
  };
  walk(payload, "");
  return out;
}

export const mapResponse: (
  config: MapResponseConfig,
  ctx: MapContext,
  payload: SourcePayload,
  now?: number,
) => MappedResult = (config, ctx, payload, now = NO_CLOCK) => {
  const locale = config.locales?.[0] ?? DEFAULT_LOCALE;
  const mappingIndex = selectMapping(config, ctx, now);
  const mapping = mappingIndex === null ? undefined : config.responseMappings[mappingIndex];
  if (mappingIndex === null || mapping === undefined) {
    return { mappingIndex: null, elements: genericDump(payload, locale), diagnostics: [] };
  }
  const diagnostics: MappingDiagnostic[] = [];
  const elements: RenderElement[] = [];
  for (const element of mapping.elements) {
    const rendered = mapElement(element, payload, locale, diagnostics);
    if (rendered !== null) elements.push(rendered);
  }
  return { mappingIndex, elements, diagnostics };
};
