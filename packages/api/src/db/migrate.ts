import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from "./client";

/** Every trigger that keeps audit_event append-only (migration 0001); all must exist. */
export const AUDIT_TRIGGERS = [
  "audit_event_no_update",
  "audit_event_no_delete",
  "audit_event_no_replace",
] as const;

export class AuditTriggerMissingError extends Error {
  constructor(readonly missing: string[]) {
    super(`audit_event triggers missing: ${missing.join(", ")}`);
    this.name = "AuditTriggerMissingError";
  }
}

/** Applies pending migrations through the serializing client from openDatabase. */
export async function runMigrations(db: Db, migrationsDir: string): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsDir });
}

/** Refuses to serve (fails closed) unless every audit_event trigger is present. */
export async function checkAuditTriggers(db: Db): Promise<void> {
  const rows = await db.$client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_event'",
    args: [],
  });
  const present = new Set(rows.rows.map((r) => String(r.name)));
  const missing = AUDIT_TRIGGERS.filter((t) => !present.has(t));
  if (missing.length > 0) throw new AuditTriggerMissingError(missing);
}
