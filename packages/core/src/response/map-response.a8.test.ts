import { describe, expect, expectTypeOf, it } from "vitest";
import { type ClientSiteConfig, toClientSiteConfig } from "../config/client-config";
import { type SiteConfig, type SiteConfigInput, SiteConfigSchema } from "../config/schema";
import { minimalSiteConfigInput } from "../config/test-fixtures";
import type { MapContext, MapResponse } from "../contracts/assess";
import { mapResponse } from "./map";

type Mapping = NonNullable<SiteConfigInput["responseMappings"]>[number];

const STATUS = {
  kind: "value",
  path: "status",
  labelKey: "mapping.status",
  view: "both",
} as const;

function config(mappings: Mapping[]): SiteConfig {
  const raw = minimalSiteConfigInput();
  raw.responseMappings = mappings;
  return SiteConfigSchema.parse(raw);
}

const VEH_SUMMARY: Mapping = {
  id: "veh-summary",
  queryType: "VEH",
  elements: [
    STATUS,
    { kind: "value", path: "plate", labelKey: "field.plate", view: "summary", highlight: false },
  ],
};

const CTX: MapContext = {
  queryType: "VEH",
  partValues: { plate: "ZZ-0001", state: "TX" },
  sourceId: "src1",
};
const STATE_PAYLOAD = { plate: "ZZ-0001", remarks: "STOLEN VEHICLE", status: "STOLEN" };

const scalarValues = (r: ReturnType<typeof mapResponse>) =>
  r.elements.map((e) => (e.kind === "scalar" ? e.value : null));

describe("mapResponse [A8]", () => {
  it("[A8] veh-summary on the ZZ-0001 state payload yields status (both) and plate (summary, no highlight)", () => {
    const r = mapResponse(config([VEH_SUMMARY]), CTX, STATE_PAYLOAD);
    expect(r.mappingIndex).toBe(0);
    expect(r.diagnostics).toEqual([]);
    expect(r.elements).toEqual([
      {
        kind: "scalar",
        label: { key: "mapping.status" },
        value: "STOLEN",
        view: "both",
        highlight: true,
      },
      {
        kind: "scalar",
        label: { key: "field.plate" },
        value: "ZZ-0001",
        view: "summary",
        highlight: false,
      },
    ]);
  });

  it("[A8] applies the element format and carries it on the element", () => {
    const m: Mapping = {
      id: "m",
      queryType: "VEH",
      elements: [
        { ...STATUS, format: { type: "upper" }, path: "owner.first" },
        { ...STATUS, path: "issued", format: { type: "date", pattern: "MM-DD-YY" } },
        { ...STATUS, path: "plate", format: { type: "template", template: "Plate {value}" } },
      ],
    };
    const r = mapResponse(config([m]), CTX, {
      owner: { first: "sample" },
      issued: "1901-02-03",
      plate: "ZZ-0001",
    });
    expect(scalarValues(r)).toEqual(["SAMPLE", "02-03-01", "Plate ZZ-0001"]);
    expect(r.elements[0]).toMatchObject({ format: { type: "upper" } });
  });

  it("[A8] a source-specific mapping beats a generic one", () => {
    const generic: Mapping = { ...VEH_SUMMARY, id: "generic" };
    const specific: Mapping = { ...VEH_SUMMARY, id: "specific", sourceId: "src1" };
    const cfg = config([generic, specific]);
    expect(mapResponse(cfg, CTX, STATE_PAYLOAD).mappingIndex).toBe(1);
    expect(mapResponse(cfg, { ...CTX, sourceId: "other" }, STATE_PAYLOAD).mappingIndex).toBe(0);
  });

  it("[A8] a mapping for another source, persona or query type is not a candidate", () => {
    const other: Mapping = { ...VEH_SUMMARY, sourceId: "other" };
    const persona: Mapping = { ...VEH_SUMMARY, persona: "dispatch" };
    const qt: Mapping = { ...VEH_SUMMARY, queryType: "DL" };
    const cfg = config([other, persona, qt]);
    expect(mapResponse(cfg, CTX, STATE_PAYLOAD).mappingIndex).toBeNull();
    expect(mapResponse(cfg, { ...CTX, persona: "dispatch" }, STATE_PAYLOAD).mappingIndex).toBe(1);
  });

  it("[A8] a when mapping beats source and persona together (4 over 2 + 1)", () => {
    const generic: Mapping = { ...VEH_SUMMARY, id: "g" };
    const both: Mapping = { ...VEH_SUMMARY, id: "sp", sourceId: "src1", persona: "dispatch" };
    const when: Mapping = {
      ...VEH_SUMMARY,
      id: "w",
      when: { field: "state", op: "eq", value: "TX" },
    };
    const cfg = config([generic, both, when]);
    expect(mapResponse(cfg, { ...CTX, persona: "dispatch" }, STATE_PAYLOAD).mappingIndex).toBe(2);
  });

  it("[A8] a when that does not hold removes the candidate", () => {
    const when: Mapping = { ...VEH_SUMMARY, when: { field: "state", op: "eq", value: "OK" } };
    const cfg = config([when]);
    expect(mapResponse(cfg, CTX, STATE_PAYLOAD).mappingIndex).toBeNull();
    const ok = { ...CTX, partValues: { state: "OK" } };
    expect(mapResponse(cfg, ok, STATE_PAYLOAD).mappingIndex).toBe(0);
  });

  it("[A8] when evaluates eq, in, notIn, notEmpty, not and $default on the part values", () => {
    const cases: [Mapping["when"], Record<string, unknown>, boolean][] = [
      [{ field: "state", op: "eq", value: "tx" }, { state: "TX" }, true],
      [{ field: "state", op: "in", value: ["ok", "tx"] }, { state: "TX" }, true],
      [{ field: "state", op: "notIn", value: ["ok"] }, { state: "TX" }, true],
      [{ field: "state", op: "notIn", value: ["tx"] }, { state: "TX" }, false],
      [{ field: "plate", op: "notEmpty" }, { plate: "ZZ-0001" }, true],
      [{ field: "plate", op: "notEmpty" }, {}, false],
      [{ not: { field: "state", op: "eq", value: "OK" } }, { state: "TX" }, true],
      [{ field: "state", op: "eq", value: { $default: "state" } }, { state: "TX" }, true],
      [{ field: "state", op: "neq", value: { $default: "state" } }, { state: "OK" }, true],
    ];
    for (const [when, partValues, expected] of cases) {
      if (when === undefined) throw new Error("fixture");
      const cfg = config([{ ...VEH_SUMMARY, when }]);
      const idx = mapResponse(cfg, { ...CTX, partValues }, STATE_PAYLOAD).mappingIndex;
      expect(idx === 0).toBe(expected);
    }
  });

  it("[A8] a when on an unknown query type never holds", () => {
    const when: Mapping = {
      ...VEH_SUMMARY,
      queryType: "ZZ",
      when: { field: "state", op: "eq", value: "TX" },
    };
    expect(mapResponse(config([when]), { ...CTX, queryType: "ZZ" }, {}).mappingIndex).toBeNull();
  });

  it("[A8] equal scores go to config order", () => {
    const a: Mapping = { ...VEH_SUMMARY, id: "a", when: { field: "state", op: "eq", value: "TX" } };
    const b: Mapping = { ...VEH_SUMMARY, id: "b", when: { field: "plate", op: "notEmpty" } };
    expect(mapResponse(config([a, b]), CTX, STATE_PAYLOAD).mappingIndex).toBe(0);
    expect(mapResponse(config([b, a]), CTX, STATE_PAYLOAD).mappingIndex).toBe(0);
  });

  it("[A8] warrants[*].offense joins with a comma", () => {
    const m: Mapping = {
      id: "m",
      queryType: "VEH",
      elements: [
        { kind: "value", path: "warrants[*].offense", labelKey: "field.offense", view: "both" },
      ],
    };
    const r = mapResponse(config([m]), CTX, {
      warrants: [{ offense: "OFFENSE ONE" }, { offense: "OFFENSE TWO" }],
    });
    expect(r.elements).toEqual([
      {
        kind: "scalar",
        label: { key: "field.offense" },
        value: "OFFENSE ONE, OFFENSE TWO",
        view: "both",
        highlight: true,
      },
    ]);
  });

  it("[A8] a plain path to an array of scalars also joins", () => {
    const m: Mapping = {
      id: "m",
      queryType: "VEH",
      elements: [{ kind: "value", path: "tags", labelKey: "field.tags", view: "both" }],
    };
    const r = mapResponse(config([m]), CTX, { tags: ["ALPHA", 2, true] });
    expect(scalarValues(r)).toEqual(["ALPHA, 2, true"]);
  });

  it("[A8] a table over warrants yields paired rows", () => {
    const m: Mapping = {
      id: "m",
      queryType: "VEH",
      elements: [
        {
          kind: "table",
          path: "warrants",
          labelKey: "field.warrants",
          view: "detail",
          columns: [
            { path: "offense", labelKey: "field.offense" },
            {
              path: "issued",
              labelKey: "field.issued",
              format: { type: "date", pattern: "MM-DD-YY" },
            },
          ],
        },
      ],
    };
    const r = mapResponse(config([m]), CTX, {
      warrants: [
        { offense: "OFFENSE ONE", issued: "1901-02-03" },
        { offense: "OFFENSE TWO" },
        { issued: "1901-04-05" },
      ],
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.elements).toEqual([
      {
        kind: "table",
        label: { key: "field.warrants" },
        view: "detail",
        highlight: true,
        columns: [
          { labelKey: "field.offense" },
          { labelKey: "field.issued", format: { type: "date", pattern: "MM-DD-YY" } },
        ],
        rows: [
          ["OFFENSE ONE", "02-03-01"],
          ["OFFENSE TWO", ""],
          ["", "04-05-01"],
        ],
      },
    ]);
  });

  it("[A8] a table over a projection path reads the records it yields", () => {
    const m: Mapping = {
      id: "m",
      queryType: "VEH",
      elements: [
        {
          kind: "table",
          path: "wrap[*].rows[*]",
          labelKey: "field.t",
          view: "both",
          columns: [{ path: "a", labelKey: "field.a" }],
        },
      ],
    };
    const r = mapResponse(config([m]), CTX, { wrap: [{ rows: [{ a: "1" }, { a: "2" }] }] });
    expect(r.elements[0]).toMatchObject({ rows: [["1"], ["2"]] });
  });

  it("[A8] a bracket-quoted key resolves", () => {
    const m: Mapping = {
      id: "m",
      queryType: "VEH",
      elements: [
        { kind: "value", path: 'vehicle["make.model"]', labelKey: "field.make", view: "both" },
      ],
    };
    const r = mapResponse(config([m]), CTX, { vehicle: { "make.model": "TESTMAKE" } });
    expect(scalarValues(r)).toEqual(["TESTMAKE"]);
  });

  it("[A8] an unresolved path yields a diagnostic and no element", () => {
    const m: Mapping = {
      id: "m",
      queryType: "VEH",
      elements: [{ kind: "value", path: "nope.here", labelKey: "field.x", view: "both" }, STATUS],
    };
    const r = mapResponse(config([m]), CTX, STATE_PAYLOAD);
    expect(r.elements).toHaveLength(1);
    expect(r.diagnostics).toEqual([{ path: "nope.here", reason: "unresolved" }]);
  });

  it("[A8] an empty table, a non-array table path and a non-record row each add a diagnostic", () => {
    const table = (path: string): Mapping["elements"][number] => ({
      kind: "table",
      path,
      labelKey: "field.t",
      view: "both",
      columns: [{ path: "a", labelKey: "field.a" }],
    });
    const m: Mapping = {
      id: "m",
      queryType: "VEH",
      elements: [table("empty"), table("text"), table("mixed"), table("gone")],
    };
    const r = mapResponse(config([m]), CTX, {
      empty: [],
      text: "PLAIN",
      mixed: [{ a: "1" }, "oops"],
    });
    expect(r.elements).toEqual([]);
    expect(r.diagnostics).toEqual([
      { path: "empty", reason: "empty table" },
      { path: "text", reason: "table path is not an array of records" },
      { path: "mixed", reason: "table path is not an array of records" },
      { path: "gone", reason: "unresolved" },
    ]);
  });

  it("[A8] a value path that yields an object is not a scalar, and no payload text leaks", () => {
    const m: Mapping = {
      id: "m",
      queryType: "VEH",
      elements: [{ kind: "value", path: "owner", labelKey: "field.owner", view: "both" }],
    };
    const r = mapResponse(config([m]), CTX, { owner: { first: "SECRETLEAF" } });
    expect(r.elements).toEqual([]);
    expect(r.diagnostics).toEqual([{ path: "owner", reason: "not a scalar" }]);
    expect(JSON.stringify(r)).not.toContain("SECRETLEAF");
  });

  it("[A8] DL with no mapping yields the generic dump in payload order", () => {
    const r = mapResponse(
      config([VEH_SUMMARY]),
      { ...CTX, queryType: "DL" },
      {
        name: "SAMPLE TESTERSON",
        "odd.key": "K",
        licence: { number: "ZZ000001", class: ["A", "B"], year: 1901 },
        active: true,
        nothing: null,
        none: [],
      },
    );
    expect(r.mappingIndex).toBeNull();
    expect(r.diagnostics).toEqual([]);
    const dump = r.elements.map((e) =>
      e.kind === "scalar" ? [e.label, e.value, e.view, e.highlight] : null,
    );
    expect(dump).toEqual([
      [{ text: "name" }, "SAMPLE TESTERSON", "both", true],
      [{ text: '["odd.key"]' }, "K", "both", true],
      [{ text: "licence.number" }, "ZZ000001", "both", true],
      [{ text: "licence.class[0]" }, "A", "both", true],
      [{ text: "licence.class[1]" }, "B", "both", true],
      [{ text: "licence.year" }, "1901", "both", true],
      [{ text: "active" }, "true", "both", true],
    ]);
  });

  it("[A8] an empty payload dumps nothing and does not throw", () => {
    expect(mapResponse(config([]), CTX, {})).toEqual({
      mappingIndex: null,
      elements: [],
      diagnostics: [],
    });
  });

  it("[A8] accepts the browser's ClientSiteConfig and is assignable to MapResponse", () => {
    const raw = minimalSiteConfigInput();
    raw.responseMappings = [VEH_SUMMARY];
    const client: ClientSiteConfig = toClientSiteConfig(
      SiteConfigSchema.parse(raw),
      "0".repeat(64),
    );
    const r = mapResponse(client, CTX, STATE_PAYLOAD);
    expect(r.mappingIndex).toBe(0);
    const assignable: MapResponse = mapResponse;
    expectTypeOf(assignable).toBeFunction();
  });
});
