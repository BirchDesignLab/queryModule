import { readFileSync } from "node:fs";
import { migrateConfig, SiteConfigSchema } from "@querymodule/core/config";
import { type MockFile, MockFileSchema } from "@querymodule/core/contracts";
import { mapResponse } from "@querymodule/core/response";
import { describe, expect, it } from "vitest";

// M2 P1 Task 9 (#602, design ruling 10; FR-060, UX-015, UX-016): the default site's cards are rich
// enough to show the card UI: every query type has a card with summary and detail rows. The
// payloads are the generated default mock's (synthetic, spec 5.4).

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
const migrated = migrateConfig(read("sites/default.json"));
if (!migrated.ok) throw new Error(migrated.error.key);
const site = SiteConfigSchema.parse(migrated.config);
const mock: MockFile = MockFileSchema.parse(read("mock/default.json"));

const TYPES = ["VEH", "PER", "PRO", "WNT", "DL"];

/** The payload of a scenario the mock answers a source's query type with, by trigger. */
function payloadOf(sourceId: string, queryType: string, when: Record<string, string>) {
  const response = mock.sources[sourceId]?.responses.find((r) => r.queryType === queryType);
  const scenario = response?.scenarios.find((s) => JSON.stringify(s.when) === JSON.stringify(when));
  if (scenario?.respond === undefined) throw new Error("the mock lacks that scenario");
  return scenario.respond;
}
const ctx = (queryType: string, sourceId: string) => ({
  queryType,
  partValues: {},
  sourceId,
});

describe("default cards (ruling 10)", () => {
  it("each of the five query types has one card, with summary and detail rows", () => {
    for (const queryType of TYPES) {
      const cards = site.responseMappings.filter((m) => m.queryType === queryType);
      expect(cards, queryType).toHaveLength(1);
      const views = new Set(cards[0]?.elements.map((e) => e.view));
      expect(views.has("detail"), `${queryType} detail`).toBe(true);
      expect(views.has("both") || views.has("summary"), `${queryType} summary`).toBe(true);
    }
  });

  it("keeps the card keys the tests and configs already name", () => {
    expect(site.responseMappings.map((m) => m.id)).toEqual([
      "veh-summary",
      "per-summary",
      "pro-summary",
      "wnt-summary",
      "dl-summary",
    ]);
  });

  it("the state system's stolen vehicle shows its summary and a detail with every path found", () => {
    const payload = payloadOf("stateSource", "VEH", { plate: "ZZ-0001" });
    const mapped = mapResponse(site, ctx("VEH", "stateSource"), payload);
    expect(mapped.mappingIndex).toBe(0);
    expect(mapped.diagnostics).toEqual([]);
    const detail = mapped.elements.filter((e) => e.view === "detail");
    expect(detail.length).toBeGreaterThanOrEqual(4);
    const summary = mapped.elements.filter((e) => e.view !== "detail");
    expect(summary.length).toBeGreaterThanOrEqual(2);
    const values = mapped.elements.flatMap((e) => (e.kind === "scalar" ? [e.value] : []));
    expect(values).toEqual(expect.arrayContaining(["STOLEN", "ZZ-0001", "TESTMAKE", "TESTERSON"]));
  });

  it("the national summary record maps its three fields and leaves the detail out", () => {
    const payload = payloadOf("nationalSource", "VEH", { plate: "ZZ-0001" });
    const mapped = mapResponse(site, ctx("VEH", "nationalSource"), payload);
    const scalars = mapped.elements.filter((e) => e.kind === "scalar");
    expect(scalars.map((e) => e.value)).toEqual(["STOLEN", "ZZ-0001", "STOLEN VEHICLE"]);
    expect(mapped.elements.every((e) => e.view !== "detail")).toBe(true);
  });

  it("a wanted person shows the warrants as a table in the detail", () => {
    const payload = payloadOf("nationalSource", "WNT", { last: "WANTED" });
    const mapped = mapResponse(site, ctx("WNT", "nationalSource"), payload);
    const table = mapped.elements.find((e) => e.kind === "table");
    expect(table?.view).toBe("detail");
    expect(table?.kind === "table" ? table.rows : []).toEqual([["FAILURE TO APPEAR", "01-02-01"]]);
  });

  it("a missing person and a stolen article map their fields", () => {
    const missing = payloadOf("nationalSource", "WNT", { last: "MISSING" });
    expect(
      mapResponse(site, ctx("WNT", "nationalSource"), missing).elements.map((e) =>
        e.kind === "scalar" ? e.value : null,
      ),
    ).toEqual(expect.arrayContaining(["MISSING PERSON", "EXAMPLESON", "TEST"]));
    const article = payloadOf("stateSource", "PRO", { serial: "ZZSTOLEN1" });
    const mapped = mapResponse(site, ctx("PRO", "stateSource"), article);
    expect(mapped.diagnostics).toEqual([]);
    expect(mapped.elements.some((e) => e.view === "detail")).toBe(true);
  });

  it("no record is a clean card: only the status shows, with its mark", () => {
    for (const queryType of TYPES) {
      const mapped = mapResponse(site, ctx(queryType, "stateSource"), { status: "NO RECORD" });
      expect(
        mapped.elements.filter((e) => e.kind === "scalar").map((e) => e.value),
        queryType,
      ).toEqual(["NO RECORD"]);
    }
  });
});
