import {
  checkFixturePolicy,
  checkMockCoverage,
  type Diagnostic,
  FIXTURE_LEAF_KEYS,
  type SiteConfig,
} from "@querymodule/core/config";
import {
  type MockFile,
  MockFileSchema,
  type MockResponse,
  type MockScenario,
  type MockSource,
  type SourcePayload,
} from "@querymodule/core/contracts";

/**
 * The mock document as the builder edits it (Task 2, #548, CFG-2; FR-043, FR-044; spec 5.4).
 * Pure helpers with immutable updates; a no-op returns its input. Diagnostics come from the same
 * core checks as the server's publish chain and carry the same pointers; the server stays
 * authoritative. Nothing here puts a trigger value or payload content into a diagnostic or a
 * change line (spec 5.9).
 */

export type ParsedMock = { ok: true; mock: MockFile } | { ok: false };

/** The draft's raw mock as the typed file, or not ok when the schema rejects it. */
export function parseMock(raw: unknown): ParsedMock {
  const parsed = MockFileSchema.safeParse(raw);
  return parsed.success ? { ok: true, mock: parsed.data } : { ok: false };
}

export interface CoverageCell {
  sourceId: string;
  queryType: string;
  covered: boolean;
}

/** Every (mock source, query type) pair the site asks, and whether the mock answers it. Same rule as checkMockCoverage. */
export function mockCoverage(site: SiteConfig, mock: MockFile | null): CoverageCell[] {
  const cells: CoverageCell[] = [];
  const mockIds = new Set(site.sources.filter((s) => s.kind === "mock").map((s) => s.id));
  for (const qt of site.queryTypes) {
    for (const ref of qt.sources) {
      if (!mockIds.has(ref.sourceId)) continue;
      const covered =
        mock?.sources[ref.sourceId]?.responses.some((r) => r.queryType === qt.code) ?? false;
      cells.push({ sourceId: ref.sourceId, queryType: qt.code, covered });
    }
  }
  return cells;
}

/** The response time a source gets when the editor creates it, in milliseconds. */
export const DEFAULT_LATENCY_MS: readonly [number, number] = [50, 400];

/** A new response: no record by default, no scenarios. Carries no person, vehicle or address leaf. */
export function scaffoldResponse(queryType: string): MockResponse {
  return { queryType, default: { status: "NO RECORD" }, scenarios: [] };
}

export type ScenarioAt = { sourceId: string; response: number; scenario: number };

function withSource(
  mock: MockFile,
  sourceId: string,
  change: (source: MockSource) => MockSource | null,
): MockFile {
  const source = mock.sources[sourceId];
  if (source === undefined) return mock;
  const next = change(source);
  if (next === null || next === source) return mock;
  return { ...mock, sources: { ...mock.sources, [sourceId]: next } };
}

function withResponse(
  mock: MockFile,
  sourceId: string,
  response: number,
  change: (r: MockResponse) => MockResponse | null,
): MockFile {
  return withSource(mock, sourceId, (source) => {
    const current = source.responses[response];
    if (current === undefined) return null;
    const next = change(current);
    if (next === null || next === current) return null;
    return { ...source, responses: source.responses.map((r, i) => (i === response ? next : r)) };
  });
}

/** Adds a response to a source; a source the mock does not have yet starts with the default response time. */
export function addResponse(mock: MockFile, sourceId: string, r: MockResponse): MockFile {
  const source = mock.sources[sourceId];
  const next: MockSource =
    source === undefined
      ? { latencyMs: [...DEFAULT_LATENCY_MS], responses: [r] }
      : { ...source, responses: [...source.responses, r] };
  return { ...mock, sources: { ...mock.sources, [sourceId]: next } };
}

/** A source's response time, shortest then longest wait in milliseconds. */
export function setSourceLatency(
  mock: MockFile,
  sourceId: string,
  latencyMs: readonly [number, number],
): MockFile {
  return withSource(mock, sourceId, (s) =>
    s.latencyMs[0] === latencyMs[0] && s.latencyMs[1] === latencyMs[1]
      ? null
      : { ...s, latencyMs: [latencyMs[0], latencyMs[1]] },
  );
}

/** The catch-all payload of a response: what answers when no scenario matches. */
export function setResponseDefault(
  mock: MockFile,
  sourceId: string,
  response: number,
  payload: SourcePayload,
): MockFile {
  return withResponse(mock, sourceId, response, (r) =>
    canon(r.default) === canon(payload) ? null : { ...r, default: payload },
  );
}

/** The type-field match of a response (a type code list), or undefined for any type. */
export function setResponseTypes(
  mock: MockFile,
  sourceId: string,
  response: number,
  types: MockResponse["types"],
): MockFile {
  return withResponse(mock, sourceId, response, (r) => {
    if (canon(r.types) === canon(types)) return null;
    const { types: _old, ...rest } = r;
    return types === undefined ? rest : { ...rest, types };
  });
}

export function addScenario(
  mock: MockFile,
  sourceId: string,
  response: number,
  scenario: MockScenario,
): MockFile {
  return withResponse(mock, sourceId, response, (r) => ({
    ...r,
    scenarios: [...r.scenarios, scenario],
  }));
}

export function updateScenario(mock: MockFile, at: ScenarioAt, s: MockScenario): MockFile {
  return withResponse(mock, at.sourceId, at.response, (r) => {
    const current = r.scenarios[at.scenario];
    if (current === undefined || canon(current) === canon(s)) return null;
    return { ...r, scenarios: r.scenarios.map((x, i) => (i === at.scenario ? s : x)) };
  });
}

export function removeScenario(mock: MockFile, at: ScenarioAt): MockFile {
  return withResponse(mock, at.sourceId, at.response, (r) =>
    r.scenarios[at.scenario] === undefined
      ? null
      : { ...r, scenarios: r.scenarios.filter((_, i) => i !== at.scenario) },
  );
}

/** Moves a scenario to position `to`; order matters, the first match wins. Out of range is a no-op. */
export function moveScenario(mock: MockFile, at: ScenarioAt, to: number): MockFile {
  return withResponse(mock, at.sourceId, at.response, (r) => {
    const moving = r.scenarios[at.scenario];
    if (moving === undefined || to === at.scenario || to < 0 || to >= r.scenarios.length)
      return null;
    const rest = r.scenarios.filter((_, i) => i !== at.scenario);
    return { ...r, scenarios: [...rest.slice(0, to), moving, ...rest.slice(to)] };
  });
}

/** The fixture allowlist, the only keys a payload row may use (Track A Task 1; no free-typed keys). */
export function payloadKeyOptions(): { key: string; kind: keyof typeof FIXTURE_LEAF_KEYS }[] {
  const kinds = Object.keys(FIXTURE_LEAF_KEYS) as (keyof typeof FIXTURE_LEAF_KEYS)[];
  return kinds.flatMap((kind) => FIXTURE_LEAF_KEYS[kind].map((key) => ({ key, kind })));
}

/**
 * Coverage gaps and fixture findings. Coverage is `checkMockCoverage` (pointers into the site
 * config); fixture findings are `checkFixturePolicy` under `/mock`, as the server reports them.
 */
export function mockDiagnostics(site: SiteConfig, mock: MockFile | null): Diagnostic[] {
  const out = checkMockCoverage(
    site,
    { ok: true, value: mock === null ? undefined : mock },
    "mock.json",
  );
  if (mock !== null)
    for (const f of checkFixturePolicy(mock))
      out.push({ level: "error", path: `/mock${f.pointer}`, key: f.key, params: {} });
  return out;
}

export type MockChange =
  | {
      kind:
        | "responseAdded"
        | "responseRemoved"
        | "matchChanged"
        | "defaultChanged"
        | "scenariosReordered";
      sourceId: string;
      queryType: string;
    }
  | {
      kind: "scenarioAdded" | "scenarioRemoved" | "scenarioChanged";
      sourceId: string;
      queryType: string;
      /** The edited index; the live index for a removed scenario. */
      scenario: number;
    }
  | { kind: "latencyChanged"; sourceId: string };

/** Key order does not matter to equality. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canon(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function diffScenarios(
  live: readonly MockScenario[],
  edited: readonly MockScenario[],
  at: { sourceId: string; queryType: string },
): MockChange[] {
  const liveLeft = new Set(live.keys());
  const editedLeft = new Set(edited.keys());
  const pairs: { from: number; to: number }[] = [];
  const out: MockChange[] = [];
  // Same trigger: the same scenario, changed or not.
  for (const to of [...editedLeft]) {
    const key = canon(edited[to]?.when);
    const from = [...liveLeft].find((i) => canon(live[i]?.when) === key);
    if (from === undefined) continue;
    liveLeft.delete(from);
    editedLeft.delete(to);
    pairs.push({ from, to });
    if (canon(live[from]) !== canon(edited[to]))
      out.push({ kind: "scenarioChanged", ...at, scenario: to });
  }
  // A different trigger on what is left, paired in order: an edited scenario.
  const lefts = [...liveLeft];
  const rights = [...editedLeft];
  for (let i = 0; i < Math.min(lefts.length, rights.length); i++) {
    const from = lefts[i] as number;
    const to = rights[i] as number;
    liveLeft.delete(from);
    editedLeft.delete(to);
    pairs.push({ from, to });
    out.push({ kind: "scenarioChanged", ...at, scenario: to });
  }
  const byEdited = [...pairs].sort((a, b) => a.to - b.to);
  if (byEdited.some((p, i) => i > 0 && p.from < (byEdited[i - 1] as { from: number }).from))
    out.push({ kind: "scenariosReordered", ...at });
  for (const to of editedLeft) out.push({ kind: "scenarioAdded", ...at, scenario: to });
  for (const from of liveLeft) out.push({ kind: "scenarioRemoved", ...at, scenario: from });
  return out;
}

/** A change and the response of the edited file it is about (its index there); null for a removed response and a source-level change. */
export interface LocatedMockChange {
  change: MockChange;
  response: number | null;
}

/**
 * What changed between the live mock and the edited one, as lines with ids and indices only (Q2,
 * 10-05-26: Review and audit lines never carry trigger values or payload content). Responses are
 * matched by query type, then by order among responses of one type; scenarios by trigger. Each change
 * also says which response of the edited file it is about, so a Review line can open that one.
 */
export function locateMockChanges(
  live: MockFile | null,
  edited: MockFile | null,
): LocatedMockChange[] {
  const out: LocatedMockChange[] = [];
  const liveSources = live?.sources ?? {};
  const editedSources = edited?.sources ?? {};
  const ids = [...new Set([...Object.keys(editedSources), ...Object.keys(liveSources)])];
  for (const sourceId of ids) {
    const was = liveSources[sourceId];
    const now = editedSources[sourceId];
    if (was !== undefined && now !== undefined && canon(was.latencyMs) !== canon(now.latencyMs))
      out.push({ change: { kind: "latencyChanged", sourceId }, response: null });
    const wasResponses = was?.responses ?? [];
    const nowResponses = now?.responses ?? [];
    const nth = (list: readonly MockResponse[], i: number): number =>
      list.slice(0, i).filter((r) => r.queryType === list[i]?.queryType).length;
    const matched = new Set<number>();
    nowResponses.forEach((r, i) => {
      const n = nth(nowResponses, i);
      const j = wasResponses.findIndex(
        (w, k) => w.queryType === r.queryType && nth(wasResponses, k) === n,
      );
      const at = { sourceId, queryType: r.queryType };
      if (j < 0) {
        out.push({ change: { kind: "responseAdded", ...at }, response: i });
        return;
      }
      matched.add(j);
      const w = wasResponses[j] as MockResponse;
      if (canon(w.types) !== canon(r.types))
        out.push({ change: { kind: "matchChanged", ...at }, response: i });
      if (canon(w.default) !== canon(r.default))
        out.push({ change: { kind: "defaultChanged", ...at }, response: i });
      for (const change of diffScenarios(w.scenarios, r.scenarios, at))
        out.push({ change, response: i });
    });
    wasResponses.forEach((w, j) => {
      if (!matched.has(j))
        out.push({
          change: { kind: "responseRemoved", sourceId, queryType: w.queryType },
          response: null,
        });
    });
  }
  return out;
}

export function diffMock(live: MockFile | null, edited: MockFile | null): MockChange[] {
  return locateMockChanges(live, edited).map((c) => c.change);
}

/** How many Review lines the edited mock has against the live one; an unreadable mock counts as one change when it differs. */
export function mockChangeCount(live: unknown, edited: unknown): number {
  if (canon(live ?? null) === canon(edited ?? null)) return 0;
  const was =
    live === null || live === undefined ? { ok: true as const, mock: null } : parseMock(live);
  const now =
    edited === null || edited === undefined ? { ok: true as const, mock: null } : parseMock(edited);
  if (!was.ok || !now.ok) return 1;
  return Math.max(1, diffMock(was.mock, now.mock).length);
}
