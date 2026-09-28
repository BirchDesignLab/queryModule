import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from "./client";

/** Every trigger that keeps audit_event append-only (migration 0001); all must exist. */
export const AUDIT_TRIGGERS = [
  "audit_event_no_update",
  "audit_event_no_delete",
  "audit_event_no_replace",
] as const;

/**
 * The statement of each trigger as migration 0001 creates it, whitespace collapsed. A trigger
 * whose stored sql differs (a body rewritten under the same name, for example through
 * PRAGMA writable_schema and an UPDATE of sqlite_master) does not count as present.
 */
export const AUDIT_TRIGGER_SQL: Record<(typeof AUDIT_TRIGGERS)[number], string> = {
  audit_event_no_update:
    "CREATE TRIGGER audit_event_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END",
  audit_event_no_delete:
    "CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END",
  audit_event_no_replace:
    "CREATE TRIGGER audit_event_no_replace BEFORE INSERT ON audit_event WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM audit_event WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END",
};

/** Some append-only trigger is missing (missing) or not the statement migration 0001 made (altered). */
export class AuditTriggerMissingError extends Error {
  constructor(
    readonly missing: string[],
    readonly altered: string[] = [],
  ) {
    const parts = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
      altered.length > 0 ? `altered: ${altered.join(", ")}` : "",
    ];
    super(`audit_event triggers ${parts.filter(Boolean).join("; ")}`);
    this.name = "AuditTriggerMissingError";
  }
}

const collapse = (sql: string) => sql.replace(/\s+/g, " ").trim().replace(/;$/, "");

/** Applies pending migrations through the serializing client from openDatabase. */
export async function runMigrations(db: Db, migrationsDir: string): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsDir });
}

/** Refuses to serve (fails closed) unless every audit_event trigger is present and unaltered. */
export async function checkAuditTriggers(db: Db): Promise<void> {
  const rows = await db.$client.execute({
    sql: "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_event'",
    args: [],
  });
  const present = new Map(rows.rows.map((r) => [String(r.name), collapse(String(r.sql))]));
  const missing = AUDIT_TRIGGERS.filter((t) => !present.has(t));
  const altered = AUDIT_TRIGGERS.filter(
    (t) => present.has(t) && present.get(t) !== AUDIT_TRIGGER_SQL[t],
  );
  if (missing.length > 0 || altered.length > 0) {
    throw new AuditTriggerMissingError(missing, altered);
  }
}
