import { CONFIG_SCHEMA_VERSION } from "../contracts/version";
import { type Diagnostic, pointer } from "./diagnostic";

export interface ConfigMigration {
  from: number;
  to: number;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

/** Ordered pure steps n -> n+1. Empty at schema version 1. */
export const CONFIG_MIGRATIONS: readonly ConfigMigration[] = [];

export type MigrateResult =
  | { ok: true; config: Record<string, unknown>; applied: { from: number; to: number }[] }
  | { ok: false; error: Diagnostic };

const fail = (path: string, key: string, params: Diagnostic["params"] = {}): MigrateResult => ({
  ok: false,
  error: { level: "error", path, key, params },
});

export function migrateConfig(
  raw: unknown,
  migrations: readonly ConfigMigration[] = CONFIG_MIGRATIONS,
  target: number = CONFIG_SCHEMA_VERSION,
): MigrateResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail(pointer(), "config.notAnObject");
  }
  let config = raw as Record<string, unknown>;
  const version = config.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return fail(pointer("schemaVersion"), "config.schemaVersionMissing");
  }
  if (version > target) {
    return fail(pointer("schemaVersion"), "config.schemaVersionTooNew", {
      found: version,
      supported: target,
    });
  }
  const applied: { from: number; to: number }[] = [];
  let current = version;
  while (current < target) {
    const step = migrations.find((m) => m.from === current);
    if (!step) return fail(pointer("schemaVersion"), "config.missingMigration", { from: current });
    // Task W2F (BR-004): each step must be pure n -> n+1 (spec 5.8). A step whose `to` is not
    // `from + 1` either loops forever (to <= from) or skips versions (to > from + 1).
    if (step.to !== step.from + 1) {
      return fail(pointer("schemaVersion"), "config.invalidMigrationStep", {
        from: step.from,
        to: step.to,
      });
    }
    config = step.migrate(config);
    applied.push({ from: step.from, to: step.to });
    current = step.to;
  }
  return { ok: true, config, applied };
}
