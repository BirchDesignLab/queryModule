import { describe, expect, it } from "vitest";
import { MockFileSchema } from "./mock-file";

const file = {
  siteId: "default",
  sources: {
    stateSource: {
      latencyMs: [50, 400],
      responses: [
        {
          queryType: "VEH",
          default: { status: "NO RECORD" },
          scenarios: [
            { when: { plate: "ZZ-0001" }, respond: { status: "STOLEN", plate: "ZZ-0001" } },
            { when: { plate: "TIMEOUT" }, behavior: "timeout" },
          ],
        },
        { queryType: "PRO", types: { propertyType: "FIREARM" }, default: { status: "NO RECORD" } },
      ],
    },
  },
};

describe("FR-044 SEC-002 mock file (spec 5.4)", () => {
  it("parses a mock file and defaults scenarios to []", () => {
    const parsed = MockFileSchema.parse(file);
    expect(parsed.sources.stateSource?.responses[1]?.scenarios).toEqual([]);
  });
  it("requires exactly one of respond or behavior", () => {
    const both = structuredClone(file) as typeof file & {
      sources: { stateSource: { responses: Array<{ scenarios: unknown[] }> } };
    };
    both.sources.stateSource.responses[0]?.scenarios.push({
      when: { plate: "X" },
      respond: {},
      behavior: "error",
    });
    expect(MockFileSchema.safeParse(both).success).toBe(false);
    const neither = structuredClone(file) as typeof both;
    neither.sources.stateSource.responses[0]?.scenarios.push({ when: { plate: "X" } });
    expect(MockFileSchema.safeParse(neither).success).toBe(false);
    const issue = MockFileSchema.safeParse(neither).error?.issues[0];
    expect(issue?.path).toEqual([
      "sources",
      "stateSource",
      "responses",
      0,
      "scenarios",
      2,
      "behavior",
    ]);
  });
  it("rejects an unknown behavior and a missing default", () => {
    const bad = structuredClone(file) as unknown as {
      siteId: string;
      sources: { stateSource: { latencyMs: number[]; responses: Array<Record<string, unknown>> } };
    };
    bad.sources.stateSource.responses[0] = { queryType: "VEH", scenarios: [] };
    expect(MockFileSchema.safeParse(bad).success).toBe(false);
    const beh = structuredClone(file) as unknown as typeof bad;
    beh.sources.stateSource.responses[0] = {
      queryType: "VEH",
      default: {},
      scenarios: [{ when: {}, behavior: "explode" }],
    };
    expect(MockFileSchema.safeParse(beh).success).toBe(false);
  });
  it("rejects a bad siteId", () => {
    const bad = structuredClone(file);
    bad.siteId = "bad site!";
    expect(MockFileSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a bad source-id key", () => {
    const bad = { siteId: "default", sources: { "bad source!": file.sources.stateSource } };
    expect(MockFileSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a bad queryType", () => {
    const bad = structuredClone(file);
    bad.sources.stateSource.responses[0].queryType = "bad type!";
    expect(MockFileSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a bad types key", () => {
    const bad = structuredClone(file);
    bad.sources.stateSource.responses[1].types = { "bad key!": "FIREARM" } as unknown as {
      propertyType: string;
    };
    expect(MockFileSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a bad types value", () => {
    const bad = structuredClone(file);
    bad.sources.stateSource.responses[1].types = { propertyType: "BLK/WHI" };
    expect(MockFileSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a bad when key", () => {
    const bad = structuredClone(file) as unknown as {
      siteId: string;
      sources: {
        stateSource: {
          latencyMs: number[];
          responses: Array<{ scenarios: Array<Record<string, unknown>> }>;
        };
      };
    };
    bad.sources.stateSource.responses[0].scenarios[0] = {
      when: { "bad key!": "ZZ-0001" },
      respond: { status: "STOLEN" },
    };
    expect(MockFileSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects latencyMs where min > max", () => {
    const bad = structuredClone(file);
    bad.sources.stateSource.latencyMs = [400, 50];
    expect(MockFileSchema.safeParse(bad).success).toBe(false);
  });
  it("accepts latencyMs where min === max", () => {
    const ok = structuredClone(file);
    ok.sources.stateSource.latencyMs = [50, 50];
    expect(MockFileSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects a negative latencyMs bound and an empty responses list", () => {
    const negative = structuredClone(file);
    negative.sources.stateSource.latencyMs = [-1, 50];
    expect(MockFileSchema.safeParse(negative).success).toBe(false);
    const empty = structuredClone(file);
    empty.sources.stateSource.responses = [];
    expect(MockFileSchema.safeParse(empty).success).toBe(false);
  });
});
