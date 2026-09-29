import { readFileSync } from "node:fs";
import {
  FEATURES,
  mergeSiteOverlay,
  migrateConfig,
  SiteConfigSchema,
  validateSiteConfig,
} from "@querymodule/core/config";
import { MockFileSchema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { BUNDLED_LOCALES } from "./index";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));

function resolve(rel: string) {
  const m = migrateConfig(read(rel));
  if (!m.ok) throw new Error(m.error.key);
  const ext = m.config.extends;
  if (typeof ext !== "string") return SiteConfigSchema.parse(m.config);
  const b = migrateConfig(read(`sites/${ext}.json`));
  if (!b.ok) throw new Error(b.error.key);
  const merged = mergeSiteOverlay(b.config, m.config);
  expect(merged.errors).toEqual([]);
  return SiteConfigSchema.parse(merged.config);
}

// Spec 4.1 "Command config checks": plateType is required when State is not the default and has no VEH position.
const PLATE_TYPE_WARNING = {
  level: "warning",
  path: "/queryTypes/0/rules/1/field",
  key: "config.conditionallyRequiredWithoutPosition",
  params: { field: "plateType", command: "VEH" },
};

describe("BR-001 shipped sites validate (spec 7)", () => {
  for (const rel of [
    "sites/default.json",
    "sites/example-ok.json",
    "test/all-on.json",
    "test/flags-off.json",
  ]) {
    it(`${rel} has no errors and only the known plateType warning`, () => {
      expect(validateSiteConfig(resolve(rel), BUNDLED_LOCALES)).toEqual({
        errors: [],
        warnings: [PLATE_TYPE_WARNING],
      });
    });

    it(`${rel} has no errors and only the known plateType warning with adapterKinds: ["mock"] (ruling W3-1)`, () => {
      expect(validateSiteConfig(resolve(rel), BUNDLED_LOCALES, { adapterKinds: ["mock"] })).toEqual(
        {
          errors: [],
          warnings: [PLATE_TYPE_WARNING],
        },
      );
    });
  }

  it("FR-004 default site: State defaults to TX; VEH allows plate-only on stateSource", () => {
    const c = resolve("sites/default.json");
    expect(c.defaults.state).toBe("TX");
    const veh = c.queryTypes.find((q) => q.code === "VEH");
    expect(veh?.allowPlateOnly).toBe(true);
    expect(veh?.sources.find((s) => s.sourceId === "stateSource")?.plateOnly).toBe(true);
    expect(c.sources.map((s) => [s.id, s.scope, s.kind])).toEqual([
      ["stateSource", "state", "mock"],
      ["nationalSource", "national", "mock"],
    ]);
    expect(Object.values(c.features).every((v) => v === false)).toBe(true);
  });

  it("FR-008 FR-031 example-ok: OK default, / delimiter, BOAT removed, tagSticker added", () => {
    const c = resolve("sites/example-ok.json");
    expect(c.site.id).toBe("example-ok");
    expect(c.defaults.state).toBe("OK");
    expect(c.terminal.delimiter).toBe("/");
    expect(
      c.picklists.find((p) => p.id === "propertyType")?.values.map((v) => v.code),
    ).not.toContain("BOAT");
    expect(
      c.queryTypes.find((q) => q.code === "VEH")?.fields.find((f) => f.key === "tagSticker")
        ?.custom,
    ).toBe(true);
  });

  it("test configs flip every flag", () => {
    // Every catalogue flag, including the admin console flags (ADR-0011).
    expect(resolve("test/all-on.json").features).toEqual(
      Object.fromEntries(FEATURES.map((k) => [k, true])),
    );
    expect(resolve("test/flags-off.json").features).toEqual(
      Object.fromEntries(FEATURES.map((k) => [k, false])),
    );
  });

  it("mock files parse and cover every (queryType, mock source) pair", () => {
    for (const site of ["default", "example-ok"]) {
      const mock = MockFileSchema.parse(read(`mock/${site}.json`));
      expect(mock.siteId).toBe(site);
      const c = resolve(`sites/${site}.json`);
      for (const qt of c.queryTypes) {
        for (const s of qt.sources) {
          expect(
            mock.sources[s.sourceId]?.responses.some((r) => r.queryType === qt.code),
            `${site} ${qt.code} ${s.sourceId}`,
          ).toBe(true);
        }
      }
    }
  });

  it("fixture policy: every payload plate uses the reserved ZZ-#### format (when triggers exempt)", () => {
    for (const site of ["default", "example-ok"]) {
      const plates = payloadPlates(MockFileSchema.parse(read(`mock/${site}.json`)).sources);
      expect(plates.length).toBeGreaterThan(0);
      for (const p of plates) expect(p).toMatch(/^ZZ-\d{4}$/);
    }
  });
});

/** Collect payload `plate` values, skipping scenario `when` objects (trigger inputs, spec 5.4). */
function payloadPlates(value: unknown, out: string[] = [], underWhen = false): string[] {
  if (Array.isArray(value)) {
    for (const v of value) payloadPlates(v, out, underWhen);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (k === "plate" && typeof v === "string" && !underWhen) out.push(v);
      payloadPlates(v, out, underWhen || k === "when");
    }
  }
  return out;
}
