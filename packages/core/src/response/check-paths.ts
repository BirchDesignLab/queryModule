import { type Diagnostic, pointer } from "../config/diagnostic";
import type { SiteConfig } from "../config/schema";
import type { MockFile, SourcePayload } from "../contracts/mock-file";
import { type MapResponseConfig, selectMapping } from "./map";
import { resolvePath } from "./path";

/**
 * config:validate path check (spec 4.5, 14): every element path of the mapping `mapResponse`
 * would choose for a mock (source, query type) pair must resolve in at least one payload of that
 * pair. Several payloads (the default and each `respond` scenario) are tried so a no-record
 * scenario that lacks fields does not warn. Warnings carry ids and an index only, never payload
 * text (spec 5.9). Pure.
 */

const NO_CLOCK = 0;

type Element = SiteConfig["responseMappings"][number]["elements"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolves(element: Element, payload: SourcePayload): boolean {
  const found = resolvePath(payload, element.path);
  if (element.kind === "value") return found.length > 0;
  const records: unknown[] = found.length === 1 && Array.isArray(found[0]) ? found[0] : found;
  if (records.length === 0) return false;
  return element.columns.every((c) =>
    records.some((r) => isRecord(r) && resolvePath(r, c.path).length > 0),
  );
}

type Tally = { sourceId: string; queryType: string; mapping: number; seen: Map<number, boolean> };

export function checkMappingPaths(config: SiteConfig, mock: MockFile): Diagnostic[] {
  const mapConfig: MapResponseConfig = config;
  // A mapping with a sourceId is checked per source; one without serves every source, so its
  // paths only need to resolve for some source (the sources send different shapes). Accepted
  // relaxation of the per-pair wording of spec 4.5 (review S1, round 2): checking each generic
  // mapping per source flags 18 shipped nationalSource shape differences (VEH, PER, DL) that the
  // generic mappings tolerate by design. docs/site-config.md describes this behavior.
  // Selection runs once with no persona and once per configured persona, so persona mappings are
  // checked too. A mapping no mock pair selects is reported, never skipped silently (review S2).
  const personas: (string | undefined)[] = [
    undefined,
    ...(config.personas ?? []).map((p) => p.key),
  ];
  const selected = new Set<number>();
  const tallies = new Map<string, Tally>();
  for (const [sourceId, source] of Object.entries(mock.sources)) {
    for (const response of source.responses) {
      const payloads: { values: Record<string, unknown>; payload: SourcePayload }[] = [
        { values: {}, payload: response.default },
      ];
      for (const s of response.scenarios) {
        if (s.respond !== undefined) payloads.push({ values: s.when, payload: s.respond });
      }
      for (const [p, persona] of payloads.flatMap((x) => personas.map((y) => [x, y] as const))) {
        const index = selectMapping(
          mapConfig,
          { queryType: response.queryType, partValues: p.values, sourceId, persona },
          NO_CLOCK,
        );
        const mapping = index === null ? undefined : config.responseMappings[index];
        if (index === null || mapping === undefined) continue;
        selected.add(index);
        const key = `${index}/${mapping.sourceId === undefined ? "" : sourceId}`;
        const tally = tallies.get(key) ?? {
          sourceId,
          queryType: response.queryType,
          mapping: index,
          seen: new Map<number, boolean>(),
        };
        tallies.set(key, tally);
        for (const [j, element] of mapping.elements.entries()) {
          tally.seen.set(j, (tally.seen.get(j) ?? false) || resolves(element, p.payload));
        }
      }
    }
  }
  const out: Diagnostic[] = [];
  for (const [i, mapping] of config.responseMappings.entries()) {
    if (selected.has(i)) continue;
    out.push({
      level: "warning",
      path: pointer("responseMappings", i),
      key: "config.mappingNotExercised",
      params: { queryType: mapping.queryType },
    });
  }
  for (const t of tallies.values()) {
    for (const [j, ok] of t.seen) {
      if (ok) continue;
      out.push({
        level: "warning",
        path: pointer("responseMappings", t.mapping, "elements", j),
        key: "config.mappingPathUnresolved",
        params: { sourceId: t.sourceId, queryType: t.queryType, scenario: "default" },
      });
    }
  }
  return out;
}
