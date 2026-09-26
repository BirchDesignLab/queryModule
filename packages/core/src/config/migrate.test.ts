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
  it("rejects a missing schemaVersion with the full diagnostic", () => {
    expect(migrateConfig({})).toEqual({
      ok: false,
      error: {
        level: "error",
        path: "/schemaVersion",
        key: "config.schemaVersionMissing",
        params: {},
      },
    });
    expect(migrateConfig({ schemaVersion: "1" })).toEqual({
      ok: false,
      error: {
        level: "error",
        path: "/schemaVersion",
        key: "config.schemaVersionMissing",
        params: {},
      },
    });
  });

  it("rejects a non-object with the full diagnostic", () => {
    expect(migrateConfig([1])).toEqual({
      ok: false,
      error: { level: "error", path: "", key: "config.notAnObject", params: {} },
    });
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

  // Task W2F (BR-004, quality M1 on Task 11): a step whose `to` is not `from + 1` either loops
  // forever (to <= from) or skips versions; migrateConfig must guard it instead of trusting it.
  describe("Task W2F step guard: to must be from + 1", () => {
    it("rejects a step whose to equals its from (would loop forever before the guard)", () => {
      const steps = [{ from: 1, to: 1, migrate: (r: Record<string, unknown>) => r }];
      expect(migrateConfig({ schemaVersion: 1 }, steps, 2)).toEqual({
        ok: false,
        error: {
          level: "error",
          path: "/schemaVersion",
          key: "config.invalidMigrationStep",
          params: { from: 1, to: 1 },
        },
      });
    }, 1000);

    it("rejects a step that skips a version (to is from + 2)", () => {
      const steps = [
        { from: 1, to: 3, migrate: (r: Record<string, unknown>) => ({ ...r, schemaVersion: 3 }) },
      ];
      expect(migrateConfig({ schemaVersion: 1 }, steps, 3)).toEqual({
        ok: false,
        error: {
          level: "error",
          path: "/schemaVersion",
          key: "config.invalidMigrationStep",
          params: { from: 1, to: 3 },
        },
      });
    }, 1000);

    it("still applies a valid from -> from+1 chain", () => {
      const steps = [
        { from: 1, to: 2, migrate: (r: Record<string, unknown>) => ({ ...r, schemaVersion: 2 }) },
      ];
      expect(migrateConfig({ schemaVersion: 1 }, steps, 2)).toEqual({
        ok: true,
        config: { schemaVersion: 2 },
        applied: [{ from: 1, to: 2 }],
      });
    });
  });
});
