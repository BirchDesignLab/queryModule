import { readFileSync } from "node:fs";
import { migrateConfig, SiteConfigSchema } from "@querymodule/core/config";
import { isPlanError, planRequest } from "@querymodule/core/planner";
import { evaluateForm } from "@querymodule/core/rules";
import { parseCommand } from "@querymodule/core/terminal";
import { describe, expect, it } from "vitest";

// Requirements "Use Case Examples": the default site demos each example query (Track A P3 Task 22).
const now = Date.UTC(2026, 8, 29);

const raw: unknown = JSON.parse(
  readFileSync(new URL("../sites/default.json", import.meta.url), "utf8"),
);
const migrated = migrateConfig(raw);
if (!migrated.ok) throw new Error(migrated.error.key);
const site = SiteConfigSchema.parse(migrated.config);

const form = (queryType: string, input: Record<string, string>) =>
  evaluateForm(site, queryType, input, { now });

function planOf(queryType: string, input: Record<string, string>) {
  const p = planRequest(site, queryType, input, ["stateSource", "nationalSource"], { now });
  if (isPlanError(p)) throw new Error(JSON.stringify(p.errors));
  return p;
}

describe("Person examples (FR-001, FR-050, FR-052)", () => {
  it("NAM.TESTERSON.SAMPLE.01011901 parses to PER with those values", () => {
    const r = parseCommand(site, "NAM.TESTERSON.SAMPLE.01011901", { now });
    expect(r.errors).toEqual([]);
    expect(r.queryType).toBe("PER");
    expect(r.formState?.values).toMatchObject({
      last: "TESTERSON",
      first: "SAMPLE",
      dob: "1901-01-01",
      state: "TX",
    });
    expect(r.formState?.valid).toBe(true);
  });

  it("the PER command keeps its positions", () => {
    const per = site.commands.find((c) => c.code === "PER");
    expect(per?.positions).toEqual(["last", "first", "dob", "sex", "race"]);
  });

  it("PER with State OK requires DOB; State default does not (FR-011)", () => {
    expect(form("PER", { last: "TESTERSON", state: "OK" }).missingRequired).toEqual(["dob"]);
    expect(form("PER", { last: "TESTERSON" }).missingRequired).toEqual([]);
    expect(form("PER", { last: "TESTERSON", state: "OK", dob: "01011901" }).valid).toBe(true);
  });
});

describe("Driver's license with nested wanted check (FR-042)", () => {
  it("DL.ZZ1234567 plans DL and records WNT as skipped without a name", () => {
    const r = parseCommand(site, "DL.ZZ1234567", { now });
    expect(r.errors).toEqual([]);
    expect(r.queryType).toBe("DL");
    const plan = planOf("DL", r.userValues);
    expect(plan.parts.map((p) => [p.queryType, p.status])).toEqual([
      ["DL", "planned"],
      ["WNT", "skipped"],
    ]);
  });

  it("DL with a name and DOB plans the WNT part", () => {
    const plan = planOf("DL", {
      licenseNumber: "ZZ1234567",
      last: "TESTERSON",
      first: "SAMPLE",
      dob: "01011901",
    });
    expect(plan.parts.map((p) => [p.queryType, p.status])).toEqual([
      ["DL", "planned"],
      ["WNT", "planned"],
    ]);
    expect(plan.parts[1]?.sourceIds).toEqual(["nationalSource"]);
  });

  it("DL needs a license number, or a name plus DOB", () => {
    expect(form("DL", {}).missingRequired.sort()).toEqual(["dob", "last", "licenseNumber"].sort());
    expect(form("DL", { licenseNumber: "ZZ1" }).valid).toBe(true);
    expect(form("DL", { last: "TESTERSON", dob: "01011901" }).valid).toBe(true);
  });
});

describe("Property examples (FR-030 to FR-032)", () => {
  it("PROP.FIREARM.ZZ123 sets type, serial and defaults State", () => {
    const r = parseCommand(site, "PROP.FIREARM.ZZ123", { now });
    expect(r.queryType).toBe("PRO");
    expect(r.formState?.values).toMatchObject({
      propertyType: "FIREARM",
      serial: "ZZ123",
      state: "TX",
    });
  });

  it("the PRO command keeps its positions", () => {
    const pro = site.commands.find((c) => c.code === "PRO");
    expect(pro?.positions).toEqual([
      "serial",
      "propertyType",
      { field: "description", rest: true },
    ]);
  });

  it("FIREARM requires make and caliber", () => {
    const s = form("PRO", { propertyType: "FIREARM", serial: "ZZ123" });
    expect(s.missingRequired.sort()).toEqual(["caliber", "make"]);
    expect(s.fields.filter((f) => f.visible).map((f) => f.key)).toEqual(
      expect.arrayContaining(["make", "caliber"]),
    );
  });

  it("ELECTRONICS shows make and model without requiring them", () => {
    const s = form("PRO", { propertyType: "ELECTRONICS" });
    const visible = s.fields.filter((f) => f.visible).map((f) => f.key);
    expect(visible).toEqual(expect.arrayContaining(["make", "model"]));
    expect(visible).not.toContain("caliber");
    expect(s.missingRequired).toEqual([]);
  });

  it("VEHICLE requires serial (VIN); ARTICLE requires description", () => {
    expect(form("PRO", { propertyType: "VEHICLE" }).missingRequired).toEqual(["serial"]);
    expect(form("PRO", { propertyType: "ARTICLE" }).missingRequired).toEqual(["description"]);
    expect(form("PRO", { propertyType: "ARTICLE", description: "SAMPLE ITEM" }).valid).toBe(true);
  });

  it("PRO State not the default requires serial; agency has a site default", () => {
    expect(
      form("PRO", { propertyType: "ARTICLE", description: "SAMPLE ITEM", state: "OK" })
        .missingRequired,
    ).toEqual(["serial"]);
    const s = form("PRO", { propertyType: "ARTICLE", description: "SAMPLE ITEM" });
    expect(s.values.state).toBe("TX");
    expect(typeof s.values.agency).toBe("string");
    expect(s.fields.find((f) => f.key === "agency")?.section).toBe("expanded");
  });

  it("the picklist gains ELECTRONICS and VEHICLE", () => {
    const codes = site.picklists.find((p) => p.id === "propertyType")?.values.map((v) => v.code);
    expect(codes).toEqual(["FIREARM", "BOAT", "ARTICLE", "ELECTRONICS", "VEHICLE"]);
  });
});

describe("Vehicle custom expanded field (FR-008)", () => {
  it("plateColor shows with Plate Type when State is not the default", () => {
    const shown = (input: Record<string, string>) =>
      form("VEH", { plate: "ZZ-0001", ...input })
        .fields.filter((f) => f.visible)
        .map((f) => f.key);
    expect(shown({})).not.toContain("plateColor");
    expect(shown({ state: "OK" })).toEqual(expect.arrayContaining(["plateType", "plateColor"]));
    const f = form("VEH", { plate: "ZZ-0001", state: "OK" }).fields.find(
      (x) => x.key === "plateColor",
    );
    expect(f?.section).toBe("expanded");
    expect(
      site.queryTypes.find((q) => q.code === "VEH")?.fields.find((x) => x.key === "plateColor")
        ?.custom,
    ).toBe(true);
  });
});

describe("Keywords (FR-020)", () => {
  it("MISSING is critical and RECOVERED is info", () => {
    const sev = (k: string) => site.keywords.find((x) => x.keyword === k)?.severity;
    expect(sev("MISSING")).toBe("critical");
    expect(sev("RECOVERED")).toBe("info");
  });
});

describe("Response mappings (FR-030)", () => {
  it("PER, PRO, WNT and DL each have a summary mapping", () => {
    for (const qt of ["PER", "PRO", "WNT", "DL"]) {
      expect(
        site.responseMappings.some((m) => m.queryType === qt),
        qt,
      ).toBe(true);
    }
  });
});
