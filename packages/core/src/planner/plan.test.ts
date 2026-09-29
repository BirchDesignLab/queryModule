import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type SiteConfig, SiteConfigSchema } from "../config/schema";
import { auditReason, isPlanError, type Plan, planRequest } from "./plan";

const config = SiteConfigSchema.parse(
  JSON.parse(readFileSync(new URL("../../../config/sites/default.json", import.meta.url), "utf8")),
);
const now = Date.UTC(2026, 8, 28);
const ok = (r: ReturnType<typeof planRequest>): Plan => {
  if (isPlanError(r)) throw new Error(JSON.stringify(r.errors));
  return r;
};

type QueryTypeDef = SiteConfig["queryTypes"][number];

/** A structuredClone of the parsed default site with one edit applied. */
function edit(base: SiteConfig, change: (c: SiteConfig) => void): SiteConfig {
  const out = structuredClone(base);
  change(out);
  return out;
}

function queryTypeOf(c: SiteConfig, code: string): QueryTypeDef {
  const qt = c.queryTypes.find((q) => q.code === code);
  if (qt === undefined) throw new Error(`no ${code} in the default site`);
  return qt;
}

function withWntDobRequired(base: SiteConfig): SiteConfig {
  return edit(base, (c) => {
    const dob = queryTypeOf(c, "WNT").fields.find((f) => f.key === "dob");
    if (dob === undefined) throw new Error("no WNT dob");
    dob.required = true;
  });
}

function withWntNoDefaultSources(base: SiteConfig): SiteConfig {
  return edit(base, (c) => {
    for (const s of queryTypeOf(c, "WNT").sources) s.selectedByDefault = false;
  });
}

function withPerAndWntSources(base: SiteConfig, n: { per: number; wnt: number }): SiteConfig {
  const make = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      sourceId: `${prefix}${i + 1}`,
      selectedByDefault: true,
      plateOnly: false,
    }));
  return edit(base, (c) => {
    queryTypeOf(c, "PER").sources = make("perSource", n.per);
    queryTypeOf(c, "WNT").sources = make("wntSource", n.wnt);
  });
}

/** PER also runs VEH with `last` mapped to `plate`, so the nested VEH part is plate-only. */
function withPerAlsoRunVeh(base: SiteConfig, plateOnlySource: boolean): SiteConfig {
  return edit(base, (c) => {
    queryTypeOf(c, "PER").alsoRun?.push({ queryType: "VEH", fieldMap: { plate: "last" } });
    if (!plateOnlySource) for (const s of queryTypeOf(c, "VEH").sources) s.plateOnly = false;
  });
}

describe("FR-012 plate-only narrowing (spec 4.6 step 3)", () => {
  it("narrows a plate-only VEH submit to plateOnly sources and names the dropped ones", () => {
    const p = ok(
      planRequest(config, "VEH", { plate: "ZZ-0001" }, ["stateSource", "nationalSource"], { now }),
    );
    expect(p.mode).toBe("plateOnly");
    expect(p.parts[0]).toMatchObject({
      partId: 0,
      sourceIds: ["stateSource"],
      droppedSourceIds: ["nationalSource"],
      status: "planned",
    });
    expect(p.droppedSourceIds).toEqual(["nationalSource"]);
    expect(p.parts[0]?.values).toEqual({ plate: "ZZ-0001", state: "TX" });
  });
  it("rejects plate-only with no plateOnly source selected", () => {
    const r = planRequest(config, "VEH", { plate: "ZZ-0001" }, ["nationalSource"], { now });
    expect(r).toEqual({ errors: [{ key: "plan.noPlateOnlySource" }] });
  });
  it("a typed year leaves normal mode and keeps both sources", () => {
    const p = ok(
      planRequest(
        config,
        "VEH",
        { plate: "ZZ-0001", year: "26" },
        ["stateSource", "nationalSource"],
        { now },
      ),
    );
    expect([p.mode, p.parts[0]?.sourceIds]).toEqual(["normal", ["stateSource", "nationalSource"]]);
    expect([p.droppedSourceIds, p.parts[0]?.droppedSourceIds]).toEqual([[], []]);
  });
  it("a plate-only nested part is narrowed to its plateOnly defaults", () => {
    const p = ok(
      planRequest(withPerAlsoRunVeh(config, true), "PER", { last: "Testerson" }, ["stateSource"], {
        now,
      }),
    );
    expect(p.parts[2]).toMatchObject({
      partId: 2,
      queryType: "VEH",
      status: "planned",
      values: { plate: "TESTERSON", state: "TX" },
      sourceIds: ["stateSource"],
      droppedSourceIds: ["nationalSource"],
    });
    expect(p.droppedSourceIds).toEqual([]);
  });
  it("a plate-only nested part with no plateOnly default is skipped, not rejected", () => {
    const p = ok(
      planRequest(withPerAlsoRunVeh(config, false), "PER", { last: "Testerson" }, ["stateSource"], {
        now,
      }),
    );
    expect(p.parts[0]?.status).toBe("planned");
    expect(p.parts[2]).toMatchObject({
      partId: 2,
      status: "skipped",
      values: {},
      sourceIds: [],
      droppedSourceIds: [],
      skipReasons: [{ key: "plan.noPlateOnlySource" }],
    });
    expect(p.parts[2]?.mode).toBe("plateOnly");
  });
  it("each part carries its own mode; a nested plate-only part with nothing dropped still reads plateOnly", () => {
    const onlyPlateOnlyDefaults = edit(withPerAlsoRunVeh(config, true), (c) => {
      for (const s of queryTypeOf(c, "VEH").sources) if (!s.plateOnly) s.selectedByDefault = false;
    });
    const p = ok(
      planRequest(onlyPlateOnlyDefaults, "PER", { last: "Testerson" }, ["stateSource"], { now }),
    );
    expect(p.parts[0]?.mode).toBe(p.mode);
    expect(p.parts[0]?.mode).toBe("normal");
    expect(p.parts[1]?.mode).toBe("normal");
    expect(p.parts[2]).toMatchObject({
      partId: 2,
      queryType: "VEH",
      status: "planned",
      mode: "plateOnly",
      sourceIds: ["stateSource"],
      droppedSourceIds: [],
    });
  });
  it("the primary part's mode equals Plan.mode in plate-only", () => {
    const p = ok(planRequest(config, "VEH", { plate: "ZZ-0001" }, ["stateSource"], { now }));
    expect([p.mode, p.parts[0]?.mode]).toEqual(["plateOnly", "plateOnly"]);
  });
});

describe("FR-041 source selection (spec 4.6 step 2)", () => {
  it("rejects a source outside the eligible set", () => {
    expect(
      planRequest(config, "VEH", { plate: "ZZ-0001", year: "2026" }, ["nope"], { now }),
    ).toEqual({ errors: [{ key: "plan.sourceNotAllowed", params: { sourceId: "nope" } }] });
  });
  it("returns the primary's evaluateForm errors, never a partial plan", () => {
    const r = planRequest(config, "VEH", { plate: "ZZ-0001", colour: "red" }, ["stateSource"], {
      now,
    });
    expect(isPlanError(r) && r.errors).toContainEqual({
      key: "validation.unknownField",
      params: { field: "colour" },
    });
  });
  it("returns validation.unknownQueryType for an unknown primary", () => {
    expect(planRequest(config, "NOPE", {}, [], { now })).toEqual({
      errors: [{ key: "validation.unknownQueryType", params: { queryType: "NOPE" } }],
    });
  });
  it("hidden and unknown keys never enter a part", () => {
    const p = ok(
      planRequest(
        config,
        "VEH",
        { plate: "ZZ-0001", state: "TX", plateType: "PC", year: "2026" },
        ["stateSource"],
        { now },
      ),
    );
    expect(p.parts[0]?.values).not.toHaveProperty("plateType");
  });
  it("an empty selection plans the primary with no sources in normal mode", () => {
    const p = ok(planRequest(config, "VEH", { plate: "ZZ-0001", year: "2026" }, [], { now }));
    expect(p.parts[0]).toMatchObject({ status: "planned", sourceIds: [] });
  });
  it("dedupes a repeated selected source, first occurrence wins", () => {
    const p = ok(
      planRequest(
        config,
        "PER",
        { last: "Sampleworth" },
        ["nationalSource", "stateSource", "nationalSource", "stateSource"],
        { now },
      ),
    );
    expect(p.parts[0]?.sourceIds).toEqual(["nationalSource", "stateSource"]);
  });
  it("dedupes before plate-only narrowing, so kept and dropped ids appear once", () => {
    const p = ok(
      planRequest(
        config,
        "VEH",
        { plate: "ZZ-0001" },
        ["stateSource", "nationalSource", "stateSource", "nationalSource"],
        { now },
      ),
    );
    expect(p.parts[0]).toMatchObject({
      sourceIds: ["stateSource"],
      droppedSourceIds: ["nationalSource"],
    });
    expect(p.droppedSourceIds).toEqual(["nationalSource"]);
  });
  it("a duplicate does not count twice toward the pair cap", () => {
    // PER with four sources and WNT with four defaults: 8 distinct pairs, allowed.
    const wide = withPerAndWntSources(config, { per: 4, wnt: 4 });
    const ids = queryTypeOf(wide, "PER").sources.map((s) => s.sourceId);
    const p = ok(planRequest(wide, "PER", { last: "Testerson" }, [...ids, ids[0] ?? ""], { now }));
    expect(p.parts.reduce((t, x) => t + x.sourceIds.length, 0)).toBe(8);
  });
  it("records the canonical query type code for a case-folded request", () => {
    const p = ok(
      planRequest(config, "veh", { plate: "ZZ-0001", year: "2026" }, ["stateSource"], { now }),
    );
    expect(p.parts[0]?.queryType).toBe("VEH");
  });
});

describe("FR-040 multi-source routing (spec 4.6 steps 2 and 5.2 step 2)", () => {
  it("dispatches one part to every selected eligible source", () => {
    const p = ok(
      planRequest(config, "PER", { last: "Sampleworth" }, ["stateSource", "nationalSource"], {
        now,
      }),
    );
    expect(p.parts[0]?.sourceIds).toEqual(["stateSource", "nationalSource"]);
  });
  it("records role:type field values in typeValues", () => {
    const typed = edit(config, (c) => {
      const plateType = queryTypeOf(c, "VEH").fields.find((f) => f.key === "plateType");
      if (plateType === undefined) throw new Error("no VEH plateType");
      plateType.role = "type";
      plateType.visible = true;
    });
    const p = ok(
      planRequest(typed, "VEH", { plate: "ZZ-0001", plateType: "PC" }, ["stateSource"], { now }),
    );
    expect(p.parts[0]?.typeValues).toEqual({ plateType: "PC" });
  });
});

describe("FR-042 nested parts (spec 4.6 steps 4 and 5)", () => {
  it("PER plans the WNT check as part 1 through fieldMap, with its default sources", () => {
    const p = ok(
      planRequest(
        config,
        "PER",
        { last: "Testerson", first: "Pat", dob: "01011901" },
        ["stateSource"],
        { now },
      ),
    );
    expect(p.parts.map((x) => [x.partId, x.parentPartId, x.origin, x.queryType, x.status])).toEqual(
      [
        [0, null, "primary", "PER", "planned"],
        [1, 0, "alsoRun", "WNT", "planned"],
      ],
    );
    expect(p.parts[1]?.fieldMapApplied).toEqual({ last: "last", first: "first", dob: "dob" });
    const v0 = p.parts[0]?.values ?? {};
    expect(p.parts[1]?.values).toEqual({ last: v0.last, first: v0.first, dob: "1901-01-01" });
    expect(p.parts[1]?.sourceIds).toEqual(["nationalSource"]); // WNT's own selectedByDefault sources, not the parent's
  });
  it("a nested part that fails validation is skipped with audit-safe reasons; the primary proceeds", () => {
    // The shipped WNT requires only `last`, which PER also requires, so WNT never fails from PER.
    // Inline fixture: WNT additionally requires `dob` (a copy of config with that one change).
    const strict = withWntDobRequired(config);
    const p = ok(planRequest(strict, "PER", { last: "Testerson" }, ["stateSource"], { now }));
    expect(p.parts[0]?.status).toBe("planned");
    expect(p.parts[1]).toMatchObject({ partId: 1, status: "skipped", sourceIds: [], values: {} });
    expect(p.parts[1]?.skipReasons).toEqual([
      { key: "validation.required", params: { field: "dob" } },
    ]);
  });
  it("a nested part with no default sources is skipped with plan.nestedNoSources", () => {
    const p = ok(
      planRequest(withWntNoDefaultSources(config), "PER", { last: "Testerson" }, ["stateSource"], {
        now,
      }),
    );
    expect(p.parts[1]?.skipReasons).toEqual([{ key: "plan.nestedNoSources" }]);
  });
  it("skip reasons drop params other than field, labelKey and position", () => {
    const unknown = edit(config, (c) => {
      queryTypeOf(c, "PER").alsoRun = [{ queryType: "GONE", fieldMap: { last: "last" } }];
    });
    const p = ok(planRequest(unknown, "PER", { last: "Testerson" }, ["stateSource"], { now }));
    expect(p.parts[1]).toMatchObject({ queryType: "GONE", status: "skipped" });
    expect(p.parts[1]?.skipReasons).toEqual([{ key: "validation.unknownQueryType" }]);
  });
  it("an alsoRun entry whose when fails produces no part; later ids keep their index (gaps)", () => {
    const gated = edit(config, (c) => {
      const per = queryTypeOf(c, "PER");
      per.alsoRun = [
        { queryType: "WNT", fieldMap: { last: "last" }, when: { field: "first", op: "notEmpty" } },
        { queryType: "WNT", fieldMap: { last: "last" } },
      ];
    });
    const without = ok(planRequest(gated, "PER", { last: "Testerson" }, ["stateSource"], { now }));
    expect(without.parts.map((x) => x.partId)).toEqual([0, 2]);
    const withFirst = ok(
      planRequest(gated, "PER", { last: "Testerson", first: "Pat" }, ["stateSource"], { now }),
    );
    expect(withFirst.parts.map((x) => x.partId)).toEqual([0, 1, 2]);
  });
  it("a nested when reads submitted values only, never hidden ones", () => {
    const gated = edit(config, (c) => {
      queryTypeOf(c, "VEH").alsoRun = [
        {
          queryType: "WNT",
          fieldMap: { last: "plate" },
          when: { field: "plateType", op: "notEmpty" },
        },
      ];
    });
    // plateType is hidden while state is the site default TX, so it is not submitted.
    const hidden = ok(
      planRequest(gated, "VEH", { plate: "ZZ-0001", year: "2026", plateType: "PC" }, [], { now }),
    );
    expect(hidden.parts.map((x) => x.partId)).toEqual([0]);
    const shown = ok(
      planRequest(
        gated,
        "VEH",
        { plate: "ZZ-0001", year: "2026", state: "OK", plateType: "PC" },
        [],
        { now },
      ),
    );
    expect(shown.parts.map((x) => x.partId)).toEqual([0, 1]);
  });
  it("caps total dispatched pairs at 8 across parts", () => {
    // PER with five eligible sources selected, and WNT with four default sources: 9 pairs.
    const wide = withPerAndWntSources(config, { per: 5, wnt: 4 });
    const ids = queryTypeOf(wide, "PER").sources.map((s) => s.sourceId);
    expect(planRequest(wide, "PER", { last: "Testerson" }, ids, { now })).toEqual({
      errors: [{ key: "plan.tooManySources", params: { max: 8 } }],
    });
  });
  it("exactly 8 pairs across parts is allowed", () => {
    const wide = withPerAndWntSources(config, { per: 4, wnt: 4 });
    const ids = queryTypeOf(wide, "PER").sources.map((s) => s.sourceId);
    const p = ok(planRequest(wide, "PER", { last: "Testerson" }, ids, { now }));
    expect(p.parts.reduce((t, x) => t + x.sourceIds.length, 0)).toBe(8);
  });
});

describe("FR-042 skip reasons are audit-safe (spec 4.7, 5.9)", () => {
  it("keeps field, labelKey and a non-negative integer position; drops every other param", () => {
    expect(
      auditReason({
        key: "validation.tooLong",
        params: { field: "last", labelKey: "field.last", position: 2, max: 10, value: "TESTERSON" },
      }),
    ).toEqual({
      key: "validation.tooLong",
      params: { field: "last", labelKey: "field.last", position: 2 },
    });
  });
  it("drops a position that the audit schema would reject", () => {
    expect(auditReason({ key: "k.a", params: { position: -1 } })).toEqual({ key: "k.a" });
    expect(auditReason({ key: "k.a", params: { position: 1.5 } })).toEqual({ key: "k.a" });
  });
  it("drops params of the wrong type and passes a param-less reason through", () => {
    expect(auditReason({ key: "k.a", params: { field: 1, labelKey: true } })).toEqual({
      key: "k.a",
    });
    expect(auditReason({ key: "k.a" })).toEqual({ key: "k.a" });
  });
});
