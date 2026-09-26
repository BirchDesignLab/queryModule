import { describe, expect, it } from "vitest";
import { CONFIG_MIGRATIONS, migrateConfig } from "./migrate";

describe("BR-004 migrateConfig (spec 5.8)", () => {
  it("ships no steps at schema version 1", () => {
    expect(CONFIG_MIGRATIONS).toEqual([]);
  });
  it("passes a current config through untouched", () => {
    const raw = { schemaVersion: 1, site: { id: "x" } };
    expect(migrateConfig(raw)).toEqual({ ok: true, config: raw, applied: [] });
  });
  it("applies ordered steps up to the target version", () => {
    const steps = [
      {
        from: 1,
        to: 2,
        migrate: (r: Record<string, unknown>) => ({ ...r, schemaVersion: 2, a: true }),
      },
      {
        from: 2,
        to: 3,
        migrate: (r: Record<string, unknown>) => ({ ...r, schemaVersion: 3, b: true }),
      },
    ];
    expect(migrateConfig({ schemaVersion: 1 }, steps, 3)).toEqual({
      ok: true,
      config: { schemaVersion: 3, a: true, b: true },
      applied: [
        { from: 1, to: 2 },
        { from: 2, to: 3 },
      ],
    });
  });
  it("rejects a version newer than the server's", () => {
    expect(migrateConfig({ schemaVersion: 2 })).toEqual({
      ok: false,
      error: {
        level: "error",
        path: "/schemaVersion",
        key: "config.schemaVersionTooNew",
        params: { found: 2, supported: 1 },
      },
    });
  });
  it("rejects a missing or non-integer schemaVersion and a non-object", () => {
    expect(migrateConfig({}).ok).toBe(false);
    expect(migrateConfig({ schemaVersion: "1" }).ok).toBe(false);
    expect(migrateConfig([1]).ok).toBe(false);
  });
  it("reports a gap in the migration chain", () => {
    expect(migrateConfig({ schemaVersion: 1 }, [], 2)).toEqual({
      ok: false,
      error: {
        level: "error",
        path: "/schemaVersion",
        key: "config.missingMigration",
        params: { from: 1 },
      },
    });
  });
});
