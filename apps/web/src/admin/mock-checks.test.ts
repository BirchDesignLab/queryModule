import { type MockFile, MockFileSchema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { RAW_MOCK, RAW_SITE } from "../test/msw-server.js";
import { editorOf } from "./admin-config.js";
import type { DraftChecks } from "./checks.js";
import { groupByControl } from "./issues.js";
import { mockEditorIssues, mockIssuesOf, withMockIssues } from "./mock-checks.js";
import { addScenario, scaffoldResponse, setResponseDefault, updateScenario } from "./mock-model.js";

// Task 3b (#550, CFG-2): the mock's diagnostics join the builder's issues, at the server's
// pointers; the coverage gap is shown at the Coverage item. Synthetic fixtures only.

const mock: MockFile = MockFileSchema.parse(RAW_MOCK);
const doc = editorOf({ siteConfig: RAW_SITE, locales: {} }).doc;
const base = (): DraftChecks => ({
  status: "ready",
  issues: [],
  groups: new Map(),
  byPointer: new Map(),
  doc,
  labels: {},
  shipped: null,
  served: null,
});

/** The doc with a BOAT type asked of stateSource only, as the builder holds it. */
const docWithBoat = () => {
  const queryTypes = (doc.queryTypes as { sources: unknown[] }[]).slice();
  queryTypes.push({
    ...(queryTypes[0] as object),
    code: "BOAT",
    sources: [{ sourceId: "stateSource", selectedByDefault: true }],
  } as { sources: unknown[] });
  return { ...doc, queryTypes };
};

describe("mockEditorIssues (rules of the editor, Q4: a scenario needs a trigger value)", () => {
  it("is clean for the default mock", () => {
    expect(mockEditorIssues(mock)).toEqual([]);
  });

  it("flags an empty trigger value and a scenario with no trigger field, without values", () => {
    const blank = addScenario(mock, "stateSource", 0, { when: { plate: "  " }, behavior: "error" });
    const none = addScenario(blank, "stateSource", 0, { when: {}, behavior: "error" });
    const found = mockEditorIssues(none);
    const n = (mock.sources.stateSource?.responses[0]?.scenarios.length ?? 0) + 0;
    expect(found).toEqual([
      {
        level: "error",
        pointer: `/mock/sources/stateSource/responses/0/scenarios/${n}/when/plate`,
        key: "admin.mock.triggerValueEmpty",
        params: {},
      },
      {
        level: "error",
        pointer: `/mock/sources/stateSource/responses/0/scenarios/${n + 1}/when`,
        key: "admin.mock.triggerMissing",
        params: {},
      },
    ]);
  });

  it("warns, without blocking, on a blank trigger beside a filled one (it never matches)", () => {
    const m = addScenario(mock, "stateSource", 0, {
      when: { plate: "ZZ-0007", state: "", note: " " },
      behavior: "error",
    });
    const n = mock.sources.stateSource?.responses[0]?.scenarios.length ?? 0;
    const at = `/mock/sources/stateSource/responses/0/scenarios/${n}/when`;
    expect(mockEditorIssues(m)).toEqual([
      { level: "warning", pointer: `${at}/state`, key: "admin.mock.triggerValueBlank", params: {} },
      { level: "warning", pointer: `${at}/note`, key: "admin.mock.triggerValueBlank", params: {} },
    ]);
  });

  it("keeps the error on each blank trigger when no trigger has a value", () => {
    const m = addScenario(mock, "stateSource", 0, {
      when: { plate: "", state: "" },
      behavior: "error",
    });
    expect(mockEditorIssues(m).map((i) => [i.level, i.key])).toEqual([
      ["error", "admin.mock.triggerValueEmpty"],
      ["error", "admin.mock.triggerValueEmpty"],
    ]);
  });

  it("a trigger value that is a number or a boolean is not empty", () => {
    const m = addScenario(mock, "stateSource", 0, {
      when: { year: 0, flag: false },
      behavior: "error",
    });
    expect(mockEditorIssues(m)).toEqual([]);
  });
});

describe("withMockIssues", () => {
  it("is the same checks when the draft has no mock", () => {
    const checks = base();
    expect(withMockIssues(checks, null)).toBe(checks);
  });

  it("is the same checks while the base checks are not ready", () => {
    const loading = { ...base(), status: "loading" as const, doc: null };
    expect(withMockIssues(loading, mock)).toBe(loading);
  });

  it("adds fixture findings at the server's pointers, by pointer lookup", () => {
    const bad = setResponseDefault(mock, "stateSource", 0, { plate: "REALPLATE1" });
    const out = withMockIssues(base(), bad);
    expect(out.issues.map((i) => [i.pointer, i.key])).toEqual([
      ["/mock/sources/stateSource/responses/0/default/plate", "fixture.realPlate"],
    ]);
    expect(out.byPointer.get("/mock/sources/stateSource/responses/0/default/plate")).toHaveLength(
      1,
    );
    expect(JSON.stringify(out.issues)).not.toContain("REALPLATE1");
  });

  it("shows a coverage gap at the Coverage item, with the source and query type", () => {
    const out = withMockIssues({ ...base(), doc: docWithBoat() }, mock);
    expect(out.issues).toEqual([
      {
        level: "error",
        pointer: "/mock/coverage/stateSource/BOAT",
        key: "config.missingMockResponse",
        params: { sourceId: "stateSource", queryType: "BOAT" },
      },
    ]);
  });

  it("the gap goes when the response is added", () => {
    const filled = { ...mock, sources: { ...mock.sources } } as MockFile;
    const out = withMockIssues(
      { ...base(), doc: docWithBoat() },
      {
        ...filled,
        sources: {
          ...filled.sources,
          stateSource: {
            ...(filled.sources.stateSource as MockFile["sources"][string]),
            responses: [...(filled.sources.stateSource?.responses ?? []), scaffoldResponse("BOAT")],
          },
        },
      },
    );
    expect(out.issues).toEqual([]);
  });

  it("moves a gap the server found (at the source) to the Coverage item and does not repeat it", () => {
    const fromServer = {
      level: "error" as const,
      pointer: "/sources/0/id",
      key: "config.missingMockResponse",
      params: { sourceId: "stateSource", queryType: "BOAT" },
    };
    const checks = { ...base(), doc: docWithBoat(), issues: [fromServer] };
    const out = withMockIssues(checks, mock);
    expect(out.issues.map((i) => i.pointer)).toEqual(["/mock/coverage/stateSource/BOAT"]);
  });

  it("leaves other issues alone and keeps them grouped by control", () => {
    const other = {
      level: "error" as const,
      pointer: "/terminal/delimiter",
      key: "x.y",
      params: {},
    };
    const checks = {
      ...base(),
      issues: [other],
      groups: groupByControl(doc, [other]),
      byPointer: new Map([[other.pointer, [other]]]),
    };
    const bad = updateScenario(
      mock,
      { sourceId: "nationalSource", response: 0, scenario: 0 },
      { when: { plate: "" }, behavior: "error" },
    );
    const out = withMockIssues(checks, bad);
    expect(out.issues[0]).toBe(other);
    expect(out.issues).toHaveLength(2);
    expect(out.groups.get("/terminal/delimiter")).toEqual([other]);
    expect([...out.groups.keys()].some((k) => k.startsWith("/mock"))).toBe(false);
  });
});

describe("#572 Q4 as ruled: only a scenario with no non-empty trigger value is blocked", () => {
  it("a blank value beside a filled one is no error (a warning: it never matches)", () => {
    const m = addScenario(mock, "stateSource", 0, {
      when: { plate: "ZZ-0007", state: "" },
      behavior: "error",
    });
    expect(mockEditorIssues(m).map((i) => i.level)).toEqual(["warning"]);
  });

  it("every value blank flags each blank field", () => {
    const m = addScenario(mock, "stateSource", 0, {
      when: { plate: "", state: " " },
      behavior: "error",
    });
    expect(mockEditorIssues(m).map((i) => i.pointer.split("/").pop())).toEqual(["plate", "state"]);
  });
});

describe("#572 (#577) orphaned responses", () => {
  it("warns on a response whose query type no type of the site has, at the response", () => {
    const m = MockFileSchema.parse({
      ...mock,
      sources: {
        ...mock.sources,
        stateSource: {
          ...mock.sources.stateSource,
          responses: [...(mock.sources.stateSource?.responses ?? []), scaffoldResponse("GONE")],
        },
      },
    });
    const at = (mock.sources.stateSource?.responses.length ?? 0) as number;
    const found = mockIssuesOf(doc, m as unknown as Record<string, unknown> as never).filter(
      (i) => i.key === "admin.mock.orphaned",
    );
    expect(found).toEqual([
      {
        level: "warning",
        pointer: `/mock/sources/stateSource/responses/${at}`,
        key: "admin.mock.orphaned",
        params: { queryType: "GONE" },
      },
    ]);
    expect(mockIssuesOf(doc, RAW_MOCK as never).some((i) => i.key === "admin.mock.orphaned")).toBe(
      false,
    );
  });
});
