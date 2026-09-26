import { describe, expect, it } from "vitest";
import { pointer } from "./diagnostic";
import { mergeSiteOverlay } from "./merge";

const base = {
  schemaVersion: 1,
  site: { id: "default", labelKey: "site.default" },
  defaults: { state: "TX" },
  terminal: { delimiter: "." },
  theme: { defaultMode: "day" },
  quickAccess: ["VEH", "PER"],
  picklists: [
    {
      id: "propertyType",
      values: [
        { code: "FIREARM", labelKey: "a" },
        { code: "BOAT", labelKey: "b" },
      ],
    },
    { id: "state", values: [{ code: "TX", labelKey: "c" }] },
  ],
  queryTypes: [
    {
      code: "VEH",
      fields: [{ key: "plate", labelKey: "field.plate", dataType: "string" }],
      sources: [{ sourceId: "stateSource", selectedByDefault: true, plateOnly: true }],
      rules: [{ field: "plate", effect: "show" }],
    },
  ],
};

describe("BR-001 FR-008 FR-031 overlays (spec 4.1)", () => {
  it("deep-merges objects and appends keyed entities", () => {
    const { config, errors } = mergeSiteOverlay(base, {
      extends: "default",
      site: { id: "example-ok", labelKey: "site.exampleOk" },
      defaults: { state: "OK" },
      queryTypes: [
        {
          code: "VEH",
          fields: [
            { key: "tagSticker", labelKey: "field.tagSticker", dataType: "string", custom: true },
          ],
        },
      ],
    });
    expect(errors).toEqual([]);
    expect(config.defaults).toEqual({ state: "OK" });
    expect(config).not.toHaveProperty("extends");
    const veh = (
      config.queryTypes as Array<{ fields: Array<{ key: string }>; rules: unknown[] }>
    )[0];
    expect(veh?.fields.map((f) => f.key)).toEqual(["plate", "tagSticker"]);
    expect(veh?.rules).toEqual([{ field: "plate", effect: "show" }]);
  });

  it("$remove on a keyed entry deletes it (FR-031 narrowing)", () => {
    const { config } = mergeSiteOverlay(base, {
      picklists: [{ id: "propertyType", values: [{ code: "BOAT", $remove: true }] }],
    });
    const pl = (config.picklists as Array<{ id: string; values: Array<{ code: string }> }>).find(
      (p) => p.id === "propertyType",
    );
    expect(pl?.values.map((v) => v.code)).toEqual(["FIREARM"]);
  });

  it("$remove in place of an object key deletes the key", () => {
    const { config } = mergeSiteOverlay(base, { theme: { $remove: true } });
    expect(config).not.toHaveProperty("theme");
  });

  it("merges QueryType.sources by sourceId", () => {
    const { config } = mergeSiteOverlay(base, {
      queryTypes: [
        { code: "VEH", sources: [{ sourceId: "stateSource", selectedByDefault: false }] },
      ],
    });
    const veh = (config.queryTypes as Array<{ sources: unknown[] }>)[0];
    expect(veh?.sources).toEqual([
      { sourceId: "stateSource", selectedByDefault: false, plateOnly: true },
    ]);
  });

  it("replaces unkeyed arrays whole", () => {
    const { config } = mergeSiteOverlay(base, {
      quickAccess: ["PRO"],
      queryTypes: [{ code: "VEH", rules: [] }],
    });
    expect(config.quickAccess).toEqual(["PRO"]);
    expect((config.queryTypes as Array<{ rules: unknown[] }>)[0]?.rules).toEqual([]);
  });

  it("overlays are one level deep: a base with extends is an error", () => {
    const { errors } = mergeSiteOverlay({ ...base, extends: "other" }, { extends: "default" });
    expect(errors).toEqual([
      {
        level: "error",
        path: "/extends",
        key: "config.nestedExtends",
        params: { extends: "other" },
      },
    ]);
  });

  it("does not mutate its inputs", () => {
    const copy = structuredClone(base);
    mergeSiteOverlay(base, { picklists: [{ id: "state", $remove: true }] });
    expect(base).toEqual(copy);
  });
});

describe("pointer (RFC 6901)", () => {
  it("escapes ~ and /", () => {
    expect(pointer("theme", "tokens", "a/b~c", 0)).toBe("/theme/tokens/a~1b~0c/0");
  });
});
