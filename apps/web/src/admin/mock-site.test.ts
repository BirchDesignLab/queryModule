import { describe, expect, it } from "vitest";
import { RAW_SITE } from "../test/msw-server.js";
import { editorOf } from "./admin-config.js";
import { mockSiteOf, typeValuesLabel } from "./mock-site.js";

// Task 3a (#549): what the mock editor needs to know of the site, read from the builder's draft.

const doc = editorOf({ siteConfig: RAW_SITE, locales: {} }).doc;
const site = mockSiteOf(doc);

describe("mockSiteOf", () => {
  it("lists the sources and the query types with the sources each asks", () => {
    expect(site.sources.map((s) => s.id)).toEqual(["stateSource", "nationalSource"]);
    expect(site.sources[0]?.labelKey).toBe("source.stateSource");
    const wnt = site.queryTypes.find((q) => q.code === "WNT");
    expect(wnt?.sourceIds).toEqual(["nationalSource"]);
  });

  it("gives each type its fields and, when it has one, its role:type field with the picklist codes", () => {
    const pro = site.queryTypes.find((q) => q.code === "PRO");
    expect(pro?.fields.map((f) => f.key)).toContain("serial");
    expect(pro?.typeField?.key).toBe("propertyType");
    expect(pro?.typeField?.codes.map((c) => c.code)).toContain("FIREARM");
    expect(site.queryTypes.find((q) => q.code === "VEH")?.typeField).toBeNull();
  });

  it("is empty for a draft without those sections", () => {
    expect(mockSiteOf({})).toEqual({ sources: [], queryTypes: [] });
  });
});

describe("typeValuesLabel", () => {
  it("is the codes of a type match joined, empty for any type", () => {
    expect(typeValuesLabel({ propertyType: "FIREARM" })).toBe("FIREARM");
    expect(typeValuesLabel(undefined)).toBe("");
    expect(typeValuesLabel({})).toBe("");
  });
});
