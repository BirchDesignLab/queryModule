import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  type MockFile,
  MockFileSchema,
  type MockResponse,
  type MockResponseSchema,
  type MockScenario,
} from "../contracts/mock-file";
import { matchMockScenario } from "./match";

/*
 * Spec 5.4 (FR-043, FR-044; #565): one pure matcher shared by the mock adapter and the builder.
 * Among the source's responses for the query type whose every `types` entry equals the request's,
 * the most specific wins, ties by file order; in it the first scenario whose every `when` key
 * equals String() of the request value, else the response default; null when none qualifies.
 */

const DEFAULT_MOCK: MockFile = MockFileSchema.parse(
  JSON.parse(readFileSync(new URL("../../../config/mock/default.json", import.meta.url), "utf8")),
);

function req(
  queryType: string,
  values: Record<string, unknown>,
  typeValues: Record<string, string> = {},
) {
  return { queryType, values, typeValues };
}

describe("matchMockScenario over the generated default mock", () => {
  it("ZZ-0001 on stateSource VEH returns the first scenario's payload", () => {
    const m = matchMockScenario(DEFAULT_MOCK, "stateSource", req("VEH", { plate: "ZZ-0001" }));
    const entry = DEFAULT_MOCK.sources.stateSource?.responses[0];
    expect(m).toEqual({
      responseIndex: 0,
      scenarioIndex: 0,
      outcome: { kind: "respond", payload: entry?.scenarios[0]?.respond },
    });
  });

  it("ABC123 on stateSource VEH returns its own scenario", () => {
    const m = matchMockScenario(DEFAULT_MOCK, "stateSource", req("VEH", { plate: "ABC123" }));
    expect(m?.scenarioIndex).toBe(1);
    expect(m?.outcome).toEqual({
      kind: "respond",
      payload: DEFAULT_MOCK.sources.stateSource?.responses[0]?.scenarios[1]?.respond,
    });
  });

  it("an unmatched plate returns the response default with scenarioIndex null", () => {
    const m = matchMockScenario(DEFAULT_MOCK, "stateSource", req("VEH", { plate: "NOPE1" }));
    expect(m).toEqual({
      responseIndex: 0,
      scenarioIndex: null,
      outcome: {
        kind: "respond",
        payload: DEFAULT_MOCK.sources.stateSource?.responses[0]?.default,
      },
    });
  });

  it("TIMEOUT on nationalSource VEH is the timeout behaviour", () => {
    const m = matchMockScenario(DEFAULT_MOCK, "nationalSource", req("VEH", { plate: "TIMEOUT" }));
    expect(m).toEqual({
      responseIndex: 0,
      scenarioIndex: 1,
      outcome: { kind: "behavior", behavior: "timeout" },
    });
  });

  it("FAIL1 on stateSource VEH is the error behaviour", () => {
    const m = matchMockScenario(DEFAULT_MOCK, "stateSource", req("VEH", { plate: "FAIL1" }));
    expect(m?.outcome).toEqual({ kind: "behavior", behavior: "error" });
  });

  it("a query type with no response, or an unknown source, is null", () => {
    expect(matchMockScenario(DEFAULT_MOCK, "stateSource", req("WNT", { last: "WANTED" }))).toBe(
      null,
    );
    expect(matchMockScenario(DEFAULT_MOCK, "noSuchSource", req("VEH", { plate: "X" }))).toBe(null);
    expect(matchMockScenario(DEFAULT_MOCK, "constructor", req("VEH", { plate: "X" }))).toBe(null);
    expect(matchMockScenario(DEFAULT_MOCK, "__proto__", req("VEH", { plate: "X" }))).toBe(null);
  });
});

const PLAIN = { status: "PLAIN" };

function mockOf(responses: z.input<typeof MockResponseSchema>[]): MockFile {
  return MockFileSchema.parse({
    siteId: "default",
    sources: { s: { latencyMs: [0, 0], responses } },
  });
}

describe("matchMockScenario rules", () => {
  it("a number value matches a string `when`, and a number `when` matches a string value", () => {
    const mock = mockOf([
      {
        queryType: "VEH",
        default: PLAIN,
        scenarios: [
          { when: { year: "1901" }, respond: { hit: "string-when" } },
          { when: { year: 1902 }, respond: { hit: "number-when" } },
        ],
      },
    ]);
    expect(matchMockScenario(mock, "s", req("VEH", { year: 1901 }))?.scenarioIndex).toBe(0);
    expect(matchMockScenario(mock, "s", req("VEH", { year: "1902" }))?.scenarioIndex).toBe(1);
  });

  it("the first matching scenario wins, and every `when` key must be present and equal", () => {
    const mock = mockOf([
      {
        queryType: "PER",
        default: PLAIN,
        scenarios: [
          { when: { last: "A", first: "B" }, respond: { hit: 0 } },
          { when: { last: "A" }, respond: { hit: 1 } },
          { when: { last: "A" }, respond: { hit: 2 } },
        ],
      },
    ]);
    expect(matchMockScenario(mock, "s", req("PER", { last: "A" }))?.scenarioIndex).toBe(1);
    expect(matchMockScenario(mock, "s", req("PER", { last: "A", first: "B" }))?.scenarioIndex).toBe(
      0,
    );
  });

  it("the most specific `types` response wins; ties go to file order; a mismatch disqualifies", () => {
    const mock = mockOf([
      { queryType: "VEH", default: { status: "PLAIN" } },
      { queryType: "VEH", types: { plateType: "PC" }, default: { status: "PC" } },
      { queryType: "VEH", types: { plateColor: "RED" }, default: { status: "RED" } },
      {
        queryType: "VEH",
        types: { plateType: "PC", plateColor: "BLU" },
        default: { status: "PC-BLU" },
      },
    ]);
    const at = (typeValues: Record<string, string>) =>
      matchMockScenario(mock, "s", req("VEH", {}, typeValues))?.responseIndex;
    expect(at({})).toBe(0);
    expect(at({ plateType: "PC" })).toBe(1);
    expect(at({ plateType: "PC", plateColor: "RED" })).toBe(1);
    expect(at({ plateType: "PC", plateColor: "BLU" })).toBe(3);
    expect(at({ plateType: "TK", plateColor: "RED" })).toBe(2);
  });

  it("an inherited key on the request never satisfies a `when` or `types` entry", () => {
    const mock = mockOf([
      {
        queryType: "VEH",
        types: { toString: "x" },
        default: PLAIN,
      },
      {
        queryType: "VEH",
        default: PLAIN,
        scenarios: [{ when: { constructor: "x" }, respond: { hit: 1 } }],
      },
    ]);
    const m = matchMockScenario(mock, "s", req("VEH", {}));
    expect(m).toEqual({
      responseIndex: 1,
      scenarioIndex: null,
      outcome: { kind: "respond", payload: PLAIN },
    });
  });
});

/*
 * Oracle: copies of the adapter's pickResponse and pickScenario before the move
 * (packages/api/src/adapters/mock.ts at 022618d), kept here so the shared matcher is checked
 * against the rules it replaced.
 */
function oraclePickResponse(
  responses: readonly MockResponse[],
  r: { queryType: string; types: Readonly<Record<string, string>> },
): MockResponse | undefined {
  let best: MockResponse | undefined;
  let bestCount = -1;
  for (const e of responses) {
    if (e.queryType !== r.queryType) continue;
    const types = Object.entries(e.types ?? {});
    if (!types.every(([k, v]) => Object.hasOwn(r.types, k) && r.types[k] === v)) continue;
    if (types.length > bestCount) {
      best = e;
      bestCount = types.length;
    }
  }
  return best;
}

function oraclePickScenario(
  entry: MockResponse,
  r: { values: Readonly<Record<string, unknown>> },
): MockScenario | undefined {
  return entry.scenarios.find((s) =>
    Object.entries(s.when).every(
      ([k, v]) => Object.hasOwn(r.values, k) && String(v) === String(r.values[k]),
    ),
  );
}

const KEYS = ["plate", "last", "year", "plateType", "plateColor"] as const;
const TOKENS = ["A", "B", "1901", "ZZ-0001", "TIMEOUT"] as const;
const QUERY_TYPES = ["VEH", "PER"] as const;

const tokenArb = fc.constantFrom(...TOKENS);
const typeValueArb = fc.constantFrom("PC", "TK", "RED", "BLU");
const valueArb = fc.oneof(tokenArb, fc.constant(1901), fc.boolean());
const scenarioArb: fc.Arbitrary<MockScenario> = fc.record({
  when: fc.dictionary(fc.constantFrom(...KEYS), fc.oneof(tokenArb, fc.constant(1901)), {
    maxKeys: 2,
  }),
  respond: fc.record({ n: fc.nat(9) }),
});
const responseArb: fc.Arbitrary<MockResponse> = fc.record({
  queryType: fc.constantFrom(...QUERY_TYPES),
  types: fc.option(
    fc.dictionary(fc.constantFrom("plateType", "plateColor"), typeValueArb, { maxKeys: 2 }),
    {
      nil: undefined,
    },
  ),
  default: fc.record({ d: fc.nat(9) }),
  scenarios: fc.array(scenarioArb, { maxLength: 4 }),
});

describe("matchMockScenario equals the adapter rules it replaced (property)", () => {
  it("for random mocks, type values and values", () => {
    fc.assert(
      fc.property(
        fc.array(responseArb, { minLength: 1, maxLength: 5 }),
        fc.constantFrom(...QUERY_TYPES),
        fc.dictionary(fc.constantFrom("plateType", "plateColor"), typeValueArb, { maxKeys: 2 }),
        fc.dictionary(fc.constantFrom(...KEYS), valueArb, { maxKeys: 3 }),
        (responses, queryType, typeValues, values) => {
          const mock = mockOf(responses);
          const responsesParsed = mock.sources.s?.responses ?? [];
          const entry = oraclePickResponse(responsesParsed, { queryType, types: typeValues });
          const got = matchMockScenario(mock, "s", { queryType, typeValues, values });
          if (entry === undefined) {
            expect(got).toBe(null);
            return;
          }
          const scenario = oraclePickScenario(entry, { values });
          expect(got?.responseIndex).toBe(responsesParsed.indexOf(entry));
          expect(got?.scenarioIndex).toBe(scenario ? entry.scenarios.indexOf(scenario) : null);
          expect(got?.outcome).toEqual({
            kind: "respond",
            payload: scenario?.respond ?? entry.default,
          });
        },
      ),
    );
  });

  it("over the default mock for every source and query type", () => {
    const sources = Object.keys(DEFAULT_MOCK.sources);
    const qts = ["VEH", "PER", "PRO", "WNT", "DL", "XXX"];
    fc.assert(
      fc.property(
        fc.constantFrom(...sources),
        fc.constantFrom(...qts),
        fc.dictionary(
          fc.constantFrom("plate", "last", "serial"),
          fc.constantFrom(
            "ZZ-0001",
            "ABC123",
            "FAIL1",
            "TIMEOUT",
            "WANTED",
            "MISSING",
            "ZZSTOLEN1",
            "Q",
          ),
          { maxKeys: 2 },
        ),
        (sourceId, queryType, values) => {
          const responses = DEFAULT_MOCK.sources[sourceId]?.responses ?? [];
          const entry = oraclePickResponse(responses, { queryType, types: {} });
          const got = matchMockScenario(DEFAULT_MOCK, sourceId, {
            queryType,
            typeValues: {},
            values,
          });
          if (entry === undefined) {
            expect(got).toBe(null);
            return;
          }
          const scenario = oraclePickScenario(entry, { values });
          expect(got?.responseIndex).toBe(responses.indexOf(entry));
          expect(got?.scenarioIndex).toBe(scenario ? entry.scenarios.indexOf(scenario) : null);
          expect(got?.outcome).toEqual(
            scenario?.behavior !== undefined
              ? { kind: "behavior", behavior: scenario.behavior }
              : { kind: "respond", payload: scenario?.respond ?? entry.default },
          );
        },
      ),
    );
  });
});
