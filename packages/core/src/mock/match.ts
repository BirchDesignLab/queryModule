import type { MOCK_BEHAVIORS, MockFile, MockResponse, SourcePayload } from "../contracts/mock-file";

/** What the matcher reads from a request: query type, type values and form values (spec 5.4). */
export interface MockMatchRequest {
  queryType: string;
  typeValues: Readonly<Record<string, string>>;
  values: Readonly<Record<string, unknown>>;
}

/** The matched answer: the scenario's payload or behaviour, or the response default. */
export type MockOutcome =
  | { kind: "respond"; payload: SourcePayload }
  | { kind: "behavior"; behavior: (typeof MOCK_BEHAVIORS)[number] };

/**
 * Which response entry and scenario matched. `scenarioIndex` is null when no scenario matched and
 * the response default answers. The payload is the mock's own object: a caller that hands it on
 * copies it first.
 */
export interface MockMatch {
  responseIndex: number;
  scenarioIndex: number | null;
  outcome: MockOutcome;
}

/**
 * The response entry for the request (spec 5.4): queryType matches and every `types` key equals
 * the request's; most matching types wins, ties by file order. -1: none.
 */
function pickResponse(responses: readonly MockResponse[], req: MockMatchRequest): number {
  let best = -1;
  let bestCount = -1;
  responses.forEach((r, i) => {
    if (r.queryType !== req.queryType) return;
    const types = Object.entries(r.types ?? {});
    if (!types.every(([k, v]) => Object.hasOwn(req.typeValues, k) && req.typeValues[k] === v)) {
      return;
    }
    if (types.length > bestCount) {
      best = i;
      bestCount = types.length;
    }
  });
  return best;
}

/**
 * The shared mock scenario matcher (spec 5.4, 10.8; FR-043, FR-044; #565): the mock adapter and
 * the builder's Try a match both call it, so the preview answers as the server would. In the
 * source's best response entry, the first scenario whose every `when` key equals String() of the
 * request value; else the entry's default. Null for an unknown source or when no entry qualifies.
 * Pure: no clock or randomness (latency stays in the adapter).
 */
export function matchMockScenario(
  mock: MockFile,
  sourceId: string,
  req: MockMatchRequest,
): MockMatch | null {
  if (!Object.hasOwn(mock.sources, sourceId)) return null;
  const source = mock.sources[sourceId];
  if (source === undefined) return null;
  const responseIndex = pickResponse(source.responses, req);
  const entry = source.responses[responseIndex];
  if (entry === undefined) return null;
  const scenarioIndex = entry.scenarios.findIndex((s) =>
    Object.entries(s.when).every(
      ([k, v]) => Object.hasOwn(req.values, k) && String(v) === String(req.values[k]),
    ),
  );
  const scenario = entry.scenarios[scenarioIndex];
  if (scenario === undefined) {
    return {
      responseIndex,
      scenarioIndex: null,
      outcome: { kind: "respond", payload: entry.default },
    };
  }
  const outcome: MockOutcome =
    scenario.behavior !== undefined
      ? { kind: "behavior", behavior: scenario.behavior }
      : { kind: "respond", payload: scenario.respond ?? entry.default };
  return { responseIndex, scenarioIndex, outcome };
}
