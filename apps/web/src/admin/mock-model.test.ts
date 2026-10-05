import { checkFixturePolicy, SiteConfigSchema } from "@querymodule/core/config";
import { type MockFile, MockFileSchema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { RAW_MOCK, RAW_SITE } from "../test/msw-server.js";
import {
  addResponse,
  addScenario,
  diffMock,
  mockCoverage,
  mockDiagnostics,
  moveScenario,
  parseMock,
  payloadKeyOptions,
  removeScenario,
  scaffoldResponse,
  setResponseDefault,
  setSourceLatency,
  updateScenario,
} from "./mock-model.js";

// Task 2 (#548, CFG-2; FR-043, FR-044; spec 5.4): the mock document as the builder edits it. Pure
// helpers, immutable updates; the diagnostics use the same core checks and pointers as the server.

const site = SiteConfigSchema.parse(RAW_SITE);
const mock: MockFile = MockFileSchema.parse(RAW_MOCK);
const valid = (m: MockFile) => MockFileSchema.safeParse(m).success;

/** The default site plus a new query type asked of the state source only. */
function siteWithBoat() {
  return SiteConfigSchema.parse({
    ...RAW_SITE,
    queryTypes: [
      ...(RAW_SITE.queryTypes as object[]),
      {
        ...(RAW_SITE.queryTypes as { code: string }[])[0],
        code: "BOAT",
        labelKey: "queryType.veh",
        sources: [{ sourceId: "stateSource", selectedByDefault: true }],
      },
    ],
  });
}

describe("parseMock", () => {
  it("returns the typed file for a valid mock", () => {
    const parsed = parseMock(RAW_MOCK);
    expect(parsed.ok).toBe(true);
  });

  it("refuses a mock the schema rejects, without echoing its content", () => {
    const parsed = parseMock({
      siteId: "default",
      sources: { x: { latencyMs: [5, 1], responses: [] } },
    });
    expect(parsed.ok).toBe(false);
  });
});

describe("mockCoverage", () => {
  it("covers every asked pair of the default mock", () => {
    const cells = mockCoverage(site, mock);
    expect(cells.length).toBe(9);
    expect(cells.every((c) => c.covered)).toBe(true);
  });

  it("marks a new type on stateSource uncovered and leaves the others covered", () => {
    const cells = mockCoverage(siteWithBoat(), mock);
    expect(cells.filter((c) => !c.covered)).toEqual([
      { sourceId: "stateSource", queryType: "BOAT", covered: false },
    ]);
  });

  it("is the same rule as checkMockCoverage: one uncovered cell per missingMockResponse", () => {
    const gaps = mockDiagnostics(siteWithBoat(), mock).filter(
      (d) => d.key === "config.missingMockResponse",
    );
    expect(gaps.map((d) => d.params)).toEqual([{ sourceId: "stateSource", queryType: "BOAT" }]);
  });

  it("treats every pair as uncovered when there is no mock", () => {
    expect(mockCoverage(site, null).every((c) => !c.covered)).toBe(true);
  });
});

describe("scaffoldResponse", () => {
  it("is a no-record default with no scenarios, valid for the file schema and the fixture policy", () => {
    const r = scaffoldResponse("BOAT");
    expect(r).toEqual({ queryType: "BOAT", default: { status: "NO RECORD" }, scenarios: [] });
    const file = addResponse(mock, "stateSource", r);
    expect(valid(file)).toBe(true);
    expect(checkFixturePolicy(file)).toEqual([]);
  });
});

describe("addResponse", () => {
  it("appends to an existing source without touching the input", () => {
    const before = structuredClone(mock);
    const out = addResponse(mock, "stateSource", scaffoldResponse("BOAT"));
    expect(out.sources.stateSource?.responses.at(-1)?.queryType).toBe("BOAT");
    expect(mock).toEqual(before);
  });

  it("creates a missing source with the default response time", () => {
    const out = addResponse(mock, "extraSource", scaffoldResponse("VEH"));
    expect(out.sources.extraSource?.latencyMs).toEqual([50, 400]);
    expect(valid(out)).toBe(true);
  });
});

describe("scenario editing", () => {
  const at = { sourceId: "nationalSource", response: 0, scenario: 0 };
  const scenarios = (m: MockFile) => m.sources.nationalSource?.responses[0]?.scenarios ?? [];

  it("addScenario appends a scenario and keeps the file valid", () => {
    const out = addScenario(mock, "nationalSource", 0, {
      when: { plate: "ZZ-0002" },
      respond: { status: "STOLEN" },
    });
    expect(scenarios(out)).toHaveLength(scenarios(mock).length + 1);
    expect(scenarios(out).at(-1)?.when).toEqual({ plate: "ZZ-0002" });
    expect(valid(out)).toBe(true);
  });

  it("updateScenario replaces one scenario only", () => {
    const out = updateScenario(mock, at, { when: { plate: "ZZ-0003" }, behavior: "error" });
    expect(scenarios(out)[0]).toEqual({ when: { plate: "ZZ-0003" }, behavior: "error" });
    expect(scenarios(out)[1]).toEqual(scenarios(mock)[1]);
    expect(valid(out)).toBe(true);
  });

  it("removeScenario drops it", () => {
    const out = removeScenario(mock, at);
    expect(scenarios(out)).toEqual(scenarios(mock).slice(1));
    expect(valid(out)).toBe(true);
  });

  it("moveScenario changes the match order (first match wins)", () => {
    const out = moveScenario(mock, at, 1);
    expect(scenarios(out)).toEqual([scenarios(mock)[1], scenarios(mock)[0]]);
    expect(valid(out)).toBe(true);
  });

  it("moveScenario outside the list changes nothing", () => {
    expect(moveScenario(mock, at, -1)).toBe(mock);
    expect(moveScenario(mock, at, 99)).toBe(mock);
    expect(moveScenario(mock, at, 0)).toBe(mock);
  });

  it("an update at a place that is not there changes nothing", () => {
    expect(
      updateScenario(mock, { ...at, scenario: 99 }, { when: { a: "b" }, behavior: "error" }),
    ).toBe(mock);
    expect(removeScenario(mock, { sourceId: "nope", response: 0, scenario: 0 })).toBe(mock);
  });
});

describe("response and source settings", () => {
  it("setResponseDefault replaces the catch-all payload", () => {
    const out = setResponseDefault(mock, "stateSource", 0, { status: "STOLEN" });
    expect(out.sources.stateSource?.responses[0]?.default).toEqual({ status: "STOLEN" });
  });

  it("setSourceLatency sets the pair", () => {
    const out = setSourceLatency(mock, "stateSource", [10, 20]);
    expect(out.sources.stateSource?.latencyMs).toEqual([10, 20]);
  });
});

describe("payloadKeyOptions", () => {
  it("is exactly the fixture allowlist, with each key's kind", () => {
    const options = payloadKeyOptions();
    expect(options).toContainEqual({ key: "plate", kind: "plate" });
    expect(options).toContainEqual({ key: "vehicle", kind: "container" });
    expect(options.some((o) => o.key === "ssn")).toBe(false);
    expect(new Set(options.map((o) => o.key)).size).toBe(options.length);
  });
});

describe("mockDiagnostics", () => {
  it("is clean for the default mock", () => {
    expect(mockDiagnostics(site, mock)).toEqual([]);
  });

  it("a payload leaf last: SMITH yields fixture.nonSyntheticName at the server's pointer", () => {
    const bad = addScenario(mock, "stateSource", 0, {
      when: { plate: "ZZ-0009" },
      respond: { owner: { last: "SMITH" } },
    });
    const index = (bad.sources.stateSource?.responses[0]?.scenarios.length ?? 1) - 1;
    const found = mockDiagnostics(site, bad).filter((d) => d.key === "fixture.nonSyntheticName");
    expect(found).toEqual([
      {
        level: "error",
        path: `/mock/sources/stateSource/responses/0/scenarios/${index}/respond/owner/last`,
        key: "fixture.nonSyntheticName",
        params: {},
      },
    ]);
  });

  it("never carries a payload value in a diagnostic", () => {
    const bad = setResponseDefault(mock, "stateSource", 0, { plate: "REALPLATE1" });
    expect(JSON.stringify(mockDiagnostics(site, bad))).not.toContain("REALPLATE1");
  });

  it("reports the coverage gap at the source id, as the server does", () => {
    const gap = mockDiagnostics(siteWithBoat(), mock).find(
      (d) => d.key === "config.missingMockResponse",
    );
    expect(gap?.path).toBe("/sources/0/id");
  });

  it("a null mock is the missing-file error, not a crash", () => {
    expect(mockDiagnostics(site, null).map((d) => d.key)).toEqual(["config.missingMockFile"]);
  });
});

describe("diffMock (Review lines: pointers and counts only, never values)", () => {
  it("nothing changed is no lines", () => {
    expect(diffMock(mock, structuredClone(mock))).toEqual([]);
  });

  it("a response added", () => {
    const next = addResponse(mock, "stateSource", scaffoldResponse("BOAT"));
    expect(diffMock(mock, next)).toEqual([
      { kind: "responseAdded", sourceId: "stateSource", queryType: "BOAT" },
    ]);
  });

  it("a scenario added, changed and removed are one line each", () => {
    const added = addScenario(mock, "nationalSource", 0, {
      when: { plate: "ZZ-0002" },
      behavior: "error",
    });
    expect(diffMock(mock, added)).toEqual([
      { kind: "scenarioAdded", sourceId: "nationalSource", queryType: "VEH", scenario: 2 },
    ]);
    const changed = updateScenario(
      mock,
      { sourceId: "nationalSource", response: 0, scenario: 0 },
      { when: { plate: "ZZ-0001" }, behavior: "error" },
    );
    expect(diffMock(mock, changed)).toEqual([
      { kind: "scenarioChanged", sourceId: "nationalSource", queryType: "VEH", scenario: 0 },
    ]);
    const removed = removeScenario(mock, { sourceId: "nationalSource", response: 0, scenario: 1 });
    expect(diffMock(mock, removed)).toEqual([
      { kind: "scenarioRemoved", sourceId: "nationalSource", queryType: "VEH", scenario: 1 },
    ]);
  });

  it("a move is one reordered line", () => {
    const moved = moveScenario(mock, { sourceId: "nationalSource", response: 0, scenario: 0 }, 1);
    expect(diffMock(mock, moved)).toEqual([
      { kind: "scenariosReordered", sourceId: "nationalSource", queryType: "VEH" },
    ]);
  });

  it("a default change and a response time change", () => {
    const next = setSourceLatency(
      setResponseDefault(mock, "stateSource", 0, { status: "STOLEN" }),
      "stateSource",
      [1, 2],
    );
    expect(diffMock(mock, next)).toEqual([
      { kind: "latencyChanged", sourceId: "stateSource" },
      { kind: "defaultChanged", sourceId: "stateSource", queryType: "VEH" },
    ]);
  });

  it("carries no trigger value or payload content", () => {
    const next = addScenario(mock, "nationalSource", 0, {
      when: { plate: "ZZ-7777" },
      respond: { remarks: "SECRETWORD" },
    });
    const text = JSON.stringify(diffMock(mock, next));
    expect(text).not.toContain("ZZ-7777");
    expect(text).not.toContain("SECRETWORD");
  });

  it("an untouched live mock against an absent one lists every response as added", () => {
    const lines = diffMock(null, mock);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.kind === "responseAdded")).toBe(true);
  });
});
