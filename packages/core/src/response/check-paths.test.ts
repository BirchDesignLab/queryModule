import { describe, expect, it } from "vitest";
import type { SiteConfig } from "../config/schema";
import type { MockFile } from "../contracts/mock-file";
import { checkMappingPaths } from "./check-paths";

type Element = SiteConfig["responseMappings"][number]["elements"][number];

const value = (path: string): Element => ({
  kind: "value",
  labelKey: "label.x",
  path,
  view: "both",
  highlight: false,
});
const table = (path: string, columns: string[]): Element => ({
  kind: "table",
  labelKey: "label.t",
  path,
  view: "both",
  highlight: false,
  columns: columns.map((c) => ({ labelKey: "label.c", path: c })),
});

function configWith(...elements: Element[]): SiteConfig {
  return {
    queryTypes: [],
    keywords: [],
    responseMappings: [{ queryType: "DL", sourceId: "stateSource", elements }],
  } as unknown as SiteConfig;
}

function mockWith(
  defaultPayload: Record<string, unknown>,
  scenarios: MockFile["sources"][string]["responses"][number]["scenarios"] = [],
): MockFile {
  return {
    siteId: "default",
    sources: {
      stateSource: {
        latencyMs: [0, 0],
        responses: [{ queryType: "DL", default: defaultPayload, scenarios }],
      },
    },
  };
}

describe("checkMappingPaths (spec 4.5)", () => {
  it("a path present in the payload gives no warning", () => {
    const mock = mockWith({ person: { last: "Testerson" } });
    expect(checkMappingPaths(configWith(value("person.last")), mock)).toEqual([]);
  });

  it("a typo path warns once with the pointer and ids only", () => {
    const mock = mockWith({ person: { last: "Testerson" } }, [
      { when: { licenseNumber: "FAIL1" }, respond: { person: { last: "Sampleworth" } } },
    ]);
    expect(checkMappingPaths(configWith(value("person.lst")), mock)).toEqual([
      {
        level: "warning",
        path: "/responseMappings/0/elements/0",
        key: "config.mappingPathUnresolved",
        params: { sourceId: "stateSource", queryType: "DL", scenario: "default" },
      },
    ]);
  });

  it("a table over an empty array in every payload warns", () => {
    const mock = mockWith({ rows: [] }, [{ when: { a: "b" }, respond: { rows: [] } }]);
    const out = checkMappingPaths(configWith(table("rows", ["x"])), mock);
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe("/responseMappings/0/elements/0");
  });

  it("a table column that resolves in no record warns", () => {
    const mock = mockWith({ rows: [{ x: "1" }] });
    expect(checkMappingPaths(configWith(table("rows", ["y"])), mock)).toHaveLength(1);
    expect(checkMappingPaths(configWith(table("rows", ["x"])), mock)).toEqual([]);
  });

  it("a no-record scenario alone does not warn when another payload resolves the path", () => {
    const mock = mockWith({ person: { last: "Testerson" } }, [
      { when: { licenseNumber: "MISSING" }, respond: { message: "NO RECORD" } },
    ]);
    expect(checkMappingPaths(configWith(value("person.last")), mock)).toEqual([]);
  });

  it("behaviors have no payload and an unmapped pair is skipped", () => {
    const mock = mockWith({ person: { last: "Testerson" } }, [
      { when: { licenseNumber: "TIMEOUT" }, behavior: "timeout" },
    ]);
    const cfg = configWith(value("person.last"));
    expect(checkMappingPaths(cfg, mock)).toEqual([]);
    const other = { ...cfg, responseMappings: [] } as unknown as SiteConfig;
    expect(checkMappingPaths(other, mock)).toEqual([]);
  });
});
