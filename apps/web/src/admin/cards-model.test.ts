import type { ResponseMapping, SiteConfig } from "@querymodule/core/config";
import { type MockFile, MockFileSchema } from "@querymodule/core/contracts";
import { mapResponse, resolvePath } from "@querymodule/core/response";
import { describe, expect, it } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { RAW_MOCK, RAW_SITE } from "../test/msw-server.js";
import { editorOf } from "./admin-config.js";
import {
  addCard,
  addExcept,
  addKeyword,
  cardsByType,
  cardWins,
  moveCard,
  newLabelKey,
  payloadPaths,
  removeCard,
  removeExcept,
  removeKeyword,
  updateCard,
  updateExcept,
  updateKeyword,
  winningCard,
} from "./cards-model.js";
import { buildSiteConfig, flattenBundle, type JsonObject, validateDraft } from "./draft.js";

// Task 9 (#602, FR-060; spec 4.1, 4.5): pure, immutable edits of the result cards
// (`responseMappings`) and keywords, and the lookups the card editor needs. Synthetic values only.

const doc: JsonObject = editorOf({ siteConfig: RAW_SITE, locales: {} }).doc;
const mock: MockFile = MockFileSchema.parse(RAW_MOCK);
const built = buildSiteConfig(doc);
if (!built.ok) throw new Error("the default site must build");
const site: SiteConfig = built.config;
const bundle = flattenBundle(EN_BUNDLE as never);

/** The diagnostics the builder would show for a site's cards and keywords, as the server reports them. */
function diagnostics(next: SiteConfig) {
  const result = validateDraft(
    { ...doc, responseMappings: next.responseMappings, keywords: next.keywords },
    {},
    bundle,
  );
  if (!result.ok) throw new Error("the draft must stay valid in shape");
  return [...result.errors, ...result.warnings];
}

const withMappings = (responseMappings: ResponseMapping[]): SiteConfig => ({
  ...site,
  responseMappings,
});

const STATUS = {
  kind: "value",
  path: "status",
  labelKey: "mapping.status",
  view: "both",
  highlight: true,
} as const;
const card = (id: string, over: Partial<ResponseMapping> = {}): ResponseMapping => ({
  id,
  queryType: "VEH",
  elements: [STATUS],
  ...over,
});

describe("cardsByType", () => {
  it("lists every query type in config order with its cards and their array index", () => {
    const grouped = cardsByType(site);
    expect([...grouped.keys()]).toEqual(site.queryTypes.map((q) => q.code));
    const veh = grouped.get("VEH");
    const at = site.responseMappings.findIndex((m) => m.queryType === "VEH");
    expect(veh).toEqual([{ index: at, mapping: site.responseMappings[at] }]);
    expect(veh?.[0]?.mapping.id).toBe("veh-summary");
  });

  it("keeps config order within a type and gives a type without cards an empty list", () => {
    const next = withMappings([card("b"), card("a", { sourceId: "stateSource" })]);
    const veh = cardsByType(next).get("VEH");
    expect(veh?.map((c) => [c.index, c.mapping.id])).toEqual([
      [0, "b"],
      [1, "a"],
    ]);
    expect(cardsByType(next).get("PER")).toEqual([]);
  });

  it("appends a mapping whose type the site does not have, so it can still be reached", () => {
    const next = withMappings([card("x", { queryType: "GONE" })]);
    const grouped = cardsByType(next);
    expect([...grouped.keys()].at(-1)).toBe("GONE");
    expect(grouped.get("GONE")?.[0]?.index).toBe(0);
  });
});

describe("addCard", () => {
  it("appends a card for the type with one value row for status and returns its index", () => {
    const r = addCard(site, "PER");
    expect(r.index).toBe(site.responseMappings.length);
    const added = r.site.responseMappings[r.index];
    expect(added?.queryType).toBe("PER");
    expect(added?.elements).toEqual([
      { kind: "value", path: "status", labelKey: "mapping.status", view: "both", highlight: true },
    ]);
    expect(added?.sourceId).toBeUndefined();
    expect(added?.persona).toBeUndefined();
    expect(added?.when).toBeUndefined();
    expect(site.responseMappings).toHaveLength(r.index);
  });

  it("gives every new card an id no other card has, however often it is added", () => {
    let s = site;
    for (let i = 0; i < 4; i++) s = addCard(s, "VEH").site;
    const ids = s.responseMappings.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(site.responseMappings.length + 4);
  });

  it("a new card with the same narrowing as another is reported by the server's rule", () => {
    const { site: next } = addCard(site, "VEH");
    const dupes = diagnostics(next).filter((d) => d.key === "config.duplicateMapping");
    expect(dupes.map((d) => d.path)).toEqual([
      `/responseMappings/${next.responseMappings.length - 1}`,
    ]);
  });

  it("the cards the shipped site starts with raise no card diagnostics", () => {
    expect(diagnostics(site).filter((d) => d.path.startsWith("/responseMappings"))).toEqual([]);
  });
});

describe("updateCard, moveCard, removeCard", () => {
  const three = withMappings([
    card("a"),
    card("b", { sourceId: "stateSource" }),
    card("c", { sourceId: "nationalSource" }),
  ]);
  const ids = (s: SiteConfig) => s.responseMappings.map((m) => m.id);

  it("updateCard replaces one card and leaves the others the same objects", () => {
    const changed = { ...card("b", { sourceId: "stateSource" }), persona: "dispatch" };
    const next = updateCard(three, 1, changed);
    expect(next.responseMappings[1]).toBe(changed);
    expect(next.responseMappings[0]).toBe(three.responseMappings[0]);
    expect(next.responseMappings[2]).toBe(three.responseMappings[2]);
    expect(three.responseMappings[1]?.persona).toBeUndefined();
  });

  it("a no-op or an index that is not there returns the same site", () => {
    expect(updateCard(three, 1, three.responseMappings[1] as ResponseMapping)).toBe(three);
    expect(updateCard(three, 9, card("z"))).toBe(three);
    expect(updateCard(three, -1, card("z"))).toBe(three);
    expect(moveCard(three, 1, 1)).toBe(three);
    expect(moveCard(three, 7, 0)).toBe(three);
    expect(removeCard(three, 7)).toBe(three);
  });

  it("moveCard reorders the list, which is what breaks a tie in the winner", () => {
    expect(ids(moveCard(three, 2, 0))).toEqual(["c", "a", "b"]);
    expect(ids(moveCard(three, 0, 2))).toEqual(["b", "c", "a"]);
    expect(ids(moveCard(three, 1, 0))).toEqual(["b", "a", "c"]);
    expect(ids(moveCard(three, 0, 99))).toEqual(["b", "c", "a"]);
    expect(ids(moveCard(three, 2, -5))).toEqual(["c", "a", "b"]);
    expect(ids(three)).toEqual(["a", "b", "c"]);
  });

  it("two equal-score cards: the earlier one wins until it is moved down", () => {
    const tie = withMappings([card("first"), card("second")]);
    const ctx = { queryType: "VEH", partValues: {}, sourceId: "stateSource" };
    expect(winningCard(tie, ctx)).toBe(0);
    expect(winningCard(moveCard(tie, 0, 1), ctx)).toBe(0);
    expect(moveCard(tie, 0, 1).responseMappings[0]?.id).toBe("second");
  });

  it("removeCard drops one card", () => {
    expect(ids(removeCard(three, 1))).toEqual(["a", "c"]);
    expect(ids(three)).toEqual(["a", "b", "c"]);
  });
});

describe("payloadPaths", () => {
  it("lists the leaves and arrays the draft's mock payloads carry for a query type", () => {
    const veh = payloadPaths(mock, "VEH");
    expect(veh).toEqual(
      expect.arrayContaining([
        { path: "status", kind: "leaf" },
        { path: "plate", kind: "leaf" },
        { path: "owner.last", kind: "leaf" },
        { path: "vehicle.make", kind: "leaf" },
        { path: "vehicle.year", kind: "leaf" },
      ]),
    );
    expect(veh.some((p) => p.kind === "array")).toBe(false);
    expect(new Set(veh.map((p) => p.path)).size).toBe(veh.length);
  });

  it("reports an array once as an array and does not list inside it", () => {
    const wnt = payloadPaths(mock, "WNT");
    expect(wnt).toContainEqual({ path: "warrants", kind: "array" });
    expect(wnt).toContainEqual({ path: "subject.dob", kind: "leaf" });
    expect(wnt.filter((p) => p.path.startsWith("warrants"))).toEqual([
      { path: "warrants", kind: "array" },
    ]);
  });

  it("every path it lists resolves in a payload the mapper reads", () => {
    const payload = {
      status: "WANTED",
      subject: { last: "TESTERSON", dob: "1901-01-01" },
      warrants: [{ offense: "FAILURE TO APPEAR" }],
    };
    const m: MockFile = {
      siteId: "t",
      sources: {
        s: {
          latencyMs: [1, 2],
          responses: [{ queryType: "WNT", default: payload, scenarios: [] }],
        },
      },
    };
    for (const { path } of payloadPaths(m, "WNT")) {
      expect(resolvePath(payload, path)).not.toEqual([]);
    }
  });

  it("narrows to one source when given one", () => {
    const national = payloadPaths(mock, "VEH", "nationalSource").map((p) => p.path);
    const state = payloadPaths(mock, "VEH", "stateSource").map((p) => p.path);
    expect(national).toContain("remarks");
    expect(national).not.toContain("owner.last");
    expect(state).toContain("owner.last");
  });

  it("is sorted, and empty for no mock, an unknown source or a type nothing answers", () => {
    const paths = payloadPaths(mock, "VEH").map((p) => p.path);
    expect(paths).toEqual([...paths].sort());
    expect(payloadPaths(null, "VEH")).toEqual([]);
    expect(payloadPaths(mock, "VEH", "nope")).toEqual([]);
    expect(payloadPaths(mock, "NOPE")).toEqual([]);
  });

  it("writes a key that is not a plain word the way the mapper reads it", () => {
    const odd: MockFile = {
      siteId: "t",
      sources: {
        s: {
          latencyMs: [1, 2],
          responses: [
            { queryType: "VEH", default: { status: "X", "a.b": { c: "d" } }, scenarios: [] },
          ],
        },
      },
    };
    expect(payloadPaths(odd, "VEH").map((p) => p.path)).toEqual(['["a.b"].c', "status"]);
  });

  it("lists paths from scenarios as well as the default", () => {
    const m: MockFile = {
      siteId: "t",
      sources: {
        s: {
          latencyMs: [1, 2],
          responses: [
            {
              queryType: "VEH",
              default: { status: "NO RECORD" },
              scenarios: [
                {
                  when: { plate: "A" },
                  respond: { status: "STOLEN", owner: { last: "TESTERSON" } },
                },
                { when: { plate: "B" }, behavior: "timeout" },
              ],
            },
          ],
        },
      },
    };
    expect(payloadPaths(m, "VEH").map((p) => p.path)).toEqual(["owner.last", "status"]);
  });
});

describe("newLabelKey", () => {
  const MESSAGE_KEY = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/;

  it("is under mapping.<card>. and a valid message key, also for a card id with dashes", () => {
    for (const id of ["veh-summary", "veh", "per_1", "9lives", "a--b", "---", "É"]) {
      const key = newLabelKey(id, new Set());
      expect(key).toMatch(MESSAGE_KEY);
      expect(key.startsWith("mapping.")).toBe(true);
      expect(key.split(".")).toHaveLength(3);
    }
    expect(newLabelKey("veh-summary", new Set())).toBe("mapping.vehSummary.label1");
  });

  it("never returns a key that is taken, however many are", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const key = newLabelKey("veh-summary", taken);
      expect(taken.has(key)).toBe(false);
      taken.add(key);
    }
    expect(taken.size).toBe(30);
    expect(newLabelKey("veh-summary", new Set(["mapping.vehSummary.label1"]))).toBe(
      "mapping.vehSummary.label2",
    );
  });

  it("stays within the key length limit for a long card id", () => {
    const key = newLabelKey("x".repeat(500), new Set());
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).toMatch(MESSAGE_KEY);
  });
});

describe("winningCard agrees with mapResponse", () => {
  const w = (id: string, over: Partial<ResponseMapping>) => card(id, over);
  const table = withMappings([
    w("any", {}),
    w("state", { sourceId: "stateSource" }),
    w("dispatch", { persona: "dispatch" }),
    w("ok", { when: { field: "state", op: "eq", value: "OK" } }),
    w("national-ok", {
      sourceId: "nationalSource",
      when: { field: "state", op: "eq", value: "OK" },
    }),
    w("per", { queryType: "PER" }),
  ]);
  const contexts = [
    { queryType: "VEH", partValues: {}, sourceId: "stateSource" },
    { queryType: "VEH", partValues: {}, sourceId: "nationalSource" },
    { queryType: "VEH", partValues: { state: "OK" }, sourceId: "stateSource" },
    { queryType: "VEH", partValues: { state: "OK" }, sourceId: "nationalSource" },
    { queryType: "VEH", partValues: { state: "TX" }, sourceId: "nationalSource" },
    { queryType: "VEH", partValues: { state: "ok" }, sourceId: "nationalSource" },
    { queryType: "VEH", partValues: {}, sourceId: "stateSource", persona: "dispatch" },
    { queryType: "VEH", partValues: { state: "OK" }, sourceId: "stateSource", persona: "dispatch" },
    { queryType: "VEH", partValues: {}, sourceId: "otherSource", persona: "mobileUnit" },
    { queryType: "PER", partValues: {}, sourceId: "stateSource" },
    { queryType: "DL", partValues: {}, sourceId: "stateSource" },
    { queryType: "NOPE", partValues: {}, sourceId: "stateSource" },
  ];

  it.each(contexts.map((c, i) => [i, c] as const))("context %i", (_i, ctx) => {
    expect(winningCard(table, ctx)).toBe(mapResponse(table, ctx, {}).mappingIndex);
  });

  it("names the rule's winners: rule +4, source +2, persona +1, ties to config order", () => {
    const at = (i: number) => winningCard(table, contexts[i] as (typeof contexts)[number]);
    expect(at(0)).toBe(1); // state source beats any
    expect(at(1)).toBe(0); // only any fits
    expect(at(2)).toBe(3); // rule +4 beats source +2
    expect(at(3)).toBe(4); // rule +4 and source +2
    expect(at(4)).toBe(0);
    expect(at(6)).toBe(1); // source +2 beats persona +1
    expect(at(8)).toBe(0);
    expect(at(9)).toBe(5);
    expect(at(10)).toBeNull();
    expect(at(11)).toBeNull();
  });

  it("agrees on the shipped site's cards", () => {
    for (const queryType of site.queryTypes.map((q) => q.code)) {
      const ctx = { queryType, partValues: {}, sourceId: "stateSource" };
      expect(winningCard(site, ctx)).toBe(mapResponse(site, ctx, {}).mappingIndex);
      expect(winningCard(site, ctx)).not.toBeNull();
    }
  });

  it("reads a two-digit year literal with the clock it is given, as mapResponse does", () => {
    const dob = withMappings([
      card("old", {
        queryType: "PER",
        when: { field: "dob", op: "lt", value: "01-01-30" },
      }),
      card("any", { queryType: "PER" }),
    ]);
    const ctx = { queryType: "PER", partValues: { dob: "1950-01-01" }, sourceId: "stateSource" };
    const now = Date.UTC(2026, 9, 13);
    expect(winningCard(dob, ctx, now)).toBe(mapResponse(dob, ctx, {}, now).mappingIndex);
  });
});

describe("keywords and except phrases", () => {
  const keywords = (s: SiteConfig) => s.keywords.map((k) => k.keyword);

  it("addKeyword appends a trimmed keyword with its severity and returns its index", () => {
    const r = addKeyword(site, "  TESTMAKE ", "warning");
    expect(r.index).toBe(site.keywords.length);
    expect(r.site.keywords[r.index]).toEqual({ keyword: "TESTMAKE", severity: "warning" });
    expect(site.keywords).toHaveLength(r.index);
  });

  it("addKeyword with blank text changes nothing and says so", () => {
    expect(addKeyword(site, "   ", "info")).toEqual({ site, index: -1 });
  });

  it("updateKeyword replaces one keyword; a no-op or a miss returns the same site", () => {
    const first = site.keywords[0] as SiteConfig["keywords"][number];
    const next = updateKeyword(site, 0, { ...first, severity: "warning" });
    expect(next.keywords[0]?.severity).toBe("warning");
    expect(next.keywords[1]).toBe(site.keywords[1]);
    expect(updateKeyword(site, 0, first)).toBe(site);
    expect(updateKeyword(site, 99, first)).toBe(site);
  });

  it("removeKeyword drops one", () => {
    const next = removeKeyword(site, 0);
    expect(keywords(next)).toEqual(keywords(site).slice(1));
    expect(removeKeyword(site, 99)).toBe(site);
  });

  it("except phrases are added, edited and removed; an empty list leaves no except key", () => {
    const i = site.keywords.findIndex((k) => k.keyword === "EXPIRED");
    const added = addExcept(site, i, " NOT EXPIRED ");
    expect(added.keywords[i]?.except).toEqual(["NOT EXPIRED"]);
    const twice = addExcept(added, i, "EXPIRED SOON");
    expect(twice.keywords[i]?.except).toEqual(["NOT EXPIRED", "EXPIRED SOON"]);
    const edited = updateExcept(twice, i, 1, "EXPIRED LONG AGO");
    expect(edited.keywords[i]?.except).toEqual(["NOT EXPIRED", "EXPIRED LONG AGO"]);
    const one = removeExcept(edited, i, 0);
    expect(one.keywords[i]?.except).toEqual(["EXPIRED LONG AGO"]);
    const none = removeExcept(one, i, 0);
    expect(none.keywords[i]).toEqual({ keyword: "EXPIRED", severity: "warning" });
    expect("except" in (none.keywords[i] as object)).toBe(false);
    expect(site.keywords[i]?.except).toBeUndefined();
  });

  it("except edits that change nothing return the same site", () => {
    const i = site.keywords.findIndex((k) => k.keyword === "STOLEN");
    expect(addExcept(site, i, "  ")).toBe(site);
    expect(addExcept(site, 99, "X")).toBe(site);
    expect(updateExcept(site, i, 0, "NOT STOLEN")).toBe(site);
    expect(updateExcept(site, i, 9, "X")).toBe(site);
    expect(removeExcept(site, i, 9)).toBe(site);
    expect(removeExcept(site, 99, 0)).toBe(site);
  });

  it("an except phrase without its keyword is the server's diagnostic, at the same pointer", () => {
    const i = site.keywords.findIndex((k) => k.keyword === "EXPIRED");
    const bad = addExcept(site, i, "UNRELATED");
    expect(diagnostics(bad).filter((d) => d.key === "config.exceptWithoutKeyword")).toEqual([
      expect.objectContaining({ path: `/keywords/${i}/except/0` }),
    ]);
  });
});

// BW3 polish (#642, CRITIC-M4): the winner's score is the sum of its narrowings, as mapResponse
// scores them (rule +4, source +2, persona +1), so the Which card wins table can show it.
describe("cardWins score", () => {
  const row = { kind: "value", path: "plate", labelKey: "field.plate", view: "summary" } as const;
  const card = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, queryType: "VEH", elements: [row], ...over }) as unknown as ResponseMapping;
  const sited = (...cards: ResponseMapping[]) => ({ ...site, responseMappings: cards });
  const ctx = {
    queryType: "VEH",
    partValues: { plate: "ZZ-0001" },
    sourceId: "stateSource",
    persona: "dispatch",
  };
  const rule = { field: "plate", op: "eq", value: "ZZ-0001" };

  it("is 0 for a card with no narrowing, 4 for a rule, 2 for a source, 1 for a persona", () => {
    expect(cardWins(sited(card("a")), ctx).score).toBe(0);
    expect(cardWins(sited(card("a", { when: rule })), ctx).score).toBe(4);
    expect(cardWins(sited(card("a", { sourceId: "stateSource" })), ctx).score).toBe(2);
    expect(cardWins(sited(card("a", { persona: "dispatch" })), ctx).score).toBe(1);
  });

  it("sums the narrowings of the winner and is 0 when no card fits", () => {
    const all = card("a", { when: rule, sourceId: "stateSource", persona: "dispatch" });
    expect(cardWins(sited(card("b"), all), ctx)).toMatchObject({ winner: 1, score: 7 });
    expect(cardWins(sited(card("a", { persona: "mobileUnit" })), ctx)).toMatchObject({
      winner: null,
      score: 0,
    });
  });

  it("keeps the earlier card of a tie and still reports the shared score", () => {
    const tie = sited(card("a", { when: rule }), card("b", { when: { ...rule, op: "notEmpty" } }));
    expect(cardWins(tie, ctx)).toMatchObject({ winner: 0, score: 4, byOrder: true });
  });
});
