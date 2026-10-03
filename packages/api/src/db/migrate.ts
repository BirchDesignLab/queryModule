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

/**
 * Some fail-closed trigger on tables is missing (missing) or not the statement its migration
 * made (altered). One type for the audit_event and the query-table checks; the message names
 * the table set, then the trigger names, never any row data.
 */
export class TriggerMissingError extends Error {
  constructor(
    readonly tables: readonly string[],
    readonly missing: string[],
    readonly altered: string[] = [],
  ) {
    const parts = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
      altered.length > 0 ? `altered: ${altered.join(", ")}` : "",
    ];
    super(`${tables.join(", ")} triggers ${parts.filter(Boolean).join("; ")}`);
    this.name = "TriggerMissingError";
  }
}

const collapse = (sql: string) => sql.replace(/\s+/g, " ").trim().replace(/;$/, "");

/** Applies pending migrations through the serializing client from openDatabase. */
export async function runMigrations(db: Db, migrationsDir: string): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsDir });
}

/** Name and collapsed stored sql of every trigger on the given tables. */
async function storedTriggers(db: Db, tables: readonly string[]): Promise<Map<string, string>> {
  const rows = await db.$client.execute({
    sql: `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN (${tables.map(() => "?").join(", ")})`,
    args: [...tables],
  });
  return new Map(rows.rows.map((r) => [String(r.name), collapse(String(r.sql))]));
}

/** Throws TriggerMissingError unless every pinned trigger on tables is present and unaltered. */
async function checkTriggers<T extends string>(
  db: Db,
  tables: readonly string[],
  names: readonly T[],
  pinned: Record<T, string>,
): Promise<void> {
  const present = await storedTriggers(db, tables);
  const missing = names.filter((t) => !present.has(t));
  const altered = names.filter((t) => present.has(t) && present.get(t) !== pinned[t]);
  if (missing.length > 0 || altered.length > 0) {
    throw new TriggerMissingError(tables, missing, altered);
  }
}

/** Refuses to serve (fails closed) unless every audit_event trigger is present and unaltered. */
export function checkAuditTriggers(db: Db): Promise<void> {
  return checkTriggers(db, ["audit_event"], AUDIT_TRIGGERS, AUDIT_TRIGGER_SQL);
}

/**
 * Every trigger that keeps query_request insert-once and undeletable and source_result
 * write-once and undeletable (migrations 0004 and 0005, SEC-013, FR-063), and that keeps
 * query_request.origin to primary or alsoRun (migration 0006, #311); all must exist.
 * The 0005 BEFORE INSERT triggers close INSERT OR REPLACE, which fires no UPDATE trigger
 * and no DELETE trigger while recursive_triggers is off, through every uniqueness constraint
 * each table has: the primary key, the source_result (correlation_id, part_id, source_id)
 * index, the part-0 (user_id, idempotency_key) index and the rowid (both are rowid tables; an
 * auto-assigned NEW.rowid reads -1 in a BEFORE INSERT trigger, so a normal insert passes; the
 * AFTER INSERT positive_rowid triggers refuse any non-positive rowid, so no stored row can ever
 * sit at -1 and block normal inserts, #279 rr:N2). source_result_write_once also refuses an UPDATE
 * that changes the rowid, which UPDATE OR REPLACE could use to delete another row (#279 rr:N1). A
 * duplicate idempotency key aborts with 'query_request idempotency key exists', which is how
 * admission detects the idempotency race (spec 5.2 step 1). request_key has none:
 * lost-data-key.ts and purge.ts crypto-shred by deleting its rows. query_request_origin is the
 * DB enforcement of the origin enum: SQLite cannot add a CHECK to an existing table without a
 * rebuild, which the insert-once triggers and the append-only rule forbid.
 */
export const QUERY_TRIGGERS = [
  "query_request_no_update",
  "source_result_write_once",
  "source_result_no_delete",
  "query_request_no_replace",
  "query_request_idempotency_once",
  "source_result_no_replace",
  "query_request_no_delete",
  "query_request_positive_rowid",
  "source_result_positive_rowid",
  "query_request_origin",
] as const;

/** The statement of each trigger as migration 0004, 0005 or 0006 creates it, whitespace collapsed. */
export const QUERY_TRIGGER_SQL: Record<(typeof QUERY_TRIGGERS)[number], string> = {
  query_request_no_update:
    "CREATE TRIGGER query_request_no_update BEFORE UPDATE ON query_request BEGIN SELECT RAISE(ABORT, 'query_request is insert-once'); END",
  source_result_write_once:
    "CREATE TRIGGER source_result_write_once BEFORE UPDATE ON source_result WHEN OLD.status <> 'pending' OR NEW.status = 'pending' OR NEW.result_id IS NOT OLD.result_id OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.part_id IS NOT OLD.part_id OR NEW.source_id IS NOT OLD.source_id OR NEW.user_id IS NOT OLD.user_id OR NEW.credential_user_id IS NOT OLD.credential_user_id OR NEW.delegation_id IS NOT OLD.delegation_id OR NEW.adapter_kind IS NOT OLD.adapter_kind OR NEW.created_at IS NOT OLD.created_at OR NEW.rowid IS NOT OLD.rowid BEGIN SELECT RAISE(ABORT, 'source_result status is write-once from pending'); END",
  source_result_no_delete:
    "CREATE TRIGGER source_result_no_delete BEFORE DELETE ON source_result BEGIN SELECT RAISE(ABORT, 'source_result rows are never deleted'); END",
  query_request_no_replace:
    "CREATE TRIGGER query_request_no_replace BEFORE INSERT ON query_request WHEN EXISTS (SELECT 1 FROM query_request WHERE correlation_id = NEW.correlation_id AND part_id = NEW.part_id) OR EXISTS (SELECT 1 FROM query_request WHERE rowid = NEW.rowid) BEGIN SELECT RAISE(ABORT, 'query_request is insert-once'); END",
  query_request_idempotency_once:
    "CREATE TRIGGER query_request_idempotency_once BEFORE INSERT ON query_request WHEN NEW.part_id = 0 AND NEW.idempotency_key IS NOT NULL AND EXISTS (SELECT 1 FROM query_request WHERE part_id = 0 AND user_id = NEW.user_id AND idempotency_key = NEW.idempotency_key) BEGIN SELECT RAISE(ABORT, 'query_request idempotency key exists'); END",
  source_result_no_replace:
    "CREATE TRIGGER source_result_no_replace BEFORE INSERT ON source_result WHEN EXISTS (SELECT 1 FROM source_result WHERE result_id = NEW.result_id OR (correlation_id = NEW.correlation_id AND part_id = NEW.part_id AND source_id = NEW.source_id)) OR EXISTS (SELECT 1 FROM source_result WHERE rowid = NEW.rowid) BEGIN SELECT RAISE(ABORT, 'source_result rows are never replaced'); END",
  query_request_no_delete:
    "CREATE TRIGGER query_request_no_delete BEFORE DELETE ON query_request BEGIN SELECT RAISE(ABORT, 'query_request rows are never deleted'); END",
  query_request_positive_rowid:
    "CREATE TRIGGER query_request_positive_rowid AFTER INSERT ON query_request WHEN NEW.rowid < 1 BEGIN SELECT RAISE(ABORT, 'query_request rowids are positive'); END",
  source_result_positive_rowid:
    "CREATE TRIGGER source_result_positive_rowid AFTER INSERT ON source_result WHEN NEW.rowid < 1 BEGIN SELECT RAISE(ABORT, 'source_result rowids are positive'); END",
  query_request_origin:
    "CREATE TRIGGER query_request_origin BEFORE INSERT ON query_request WHEN NEW.origin NOT IN ('primary', 'alsoRun') BEGIN SELECT RAISE(ABORT, 'query_request origin must be primary or alsoRun'); END",
};

/** Refuses to serve (fails closed) unless every query-table trigger is present and unaltered. */
export function checkQueryTriggers(db: Db): Promise<void> {
  return checkTriggers(db, ["query_request", "source_result"], QUERY_TRIGGERS, QUERY_TRIGGER_SQL);
}

/**
 * Every trigger that keeps published site config history unrewritten (migration 0007, ADR-0011
 * item 1, SEC-010): a non-draft row's document, config_hash, authorship (created_by, created_at,
 * published_by, published_at) and lineage (base_version, rollback_of) never change and it never returns
 * to draft; no row's id, site, version or rowid changes; a non-draft row is never deleted; no row
 * is replaced (INSERT OR REPLACE fires no DELETE trigger while recursive_triggers is off, so the
 * BEFORE INSERT trigger refuses every conflict: id, (site_id, version), rowid and a second
 * published row); a draft is never published while another version is live (UPDATE OR REPLACE
 * would delete it through the one-published index); rowids are positive, as for the query tables.
 */
export const CONFIG_VERSION_TRIGGERS = [
  "site_config_version_frozen",
  "site_config_version_no_delete",
  "site_config_version_no_replace",
  "site_config_version_positive_rowid",
] as const;

/** The statement of each trigger as migration 0007 creates it, whitespace collapsed. */
export const CONFIG_VERSION_TRIGGER_SQL: Record<(typeof CONFIG_VERSION_TRIGGERS)[number], string> =
  {
    site_config_version_frozen:
      "CREATE TRIGGER site_config_version_frozen BEFORE UPDATE ON site_config_version WHEN (OLD.status <> 'draft' AND (NEW.document IS NOT OLD.document OR NEW.config_hash IS NOT OLD.config_hash OR NEW.status = 'draft' OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR NEW.published_by IS NOT OLD.published_by OR NEW.published_at IS NOT OLD.published_at OR NEW.base_version IS NOT OLD.base_version OR NEW.rollback_of IS NOT OLD.rollback_of)) OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.version IS NOT OLD.version OR NEW.rowid IS NOT OLD.rowid OR (NEW.status = 'published' AND OLD.status <> 'published' AND EXISTS (SELECT 1 FROM site_config_version WHERE site_id = NEW.site_id AND status = 'published')) BEGIN SELECT RAISE(ABORT, 'site_config_version history is never rewritten'); END",
    site_config_version_no_delete:
      "CREATE TRIGGER site_config_version_no_delete BEFORE DELETE ON site_config_version WHEN OLD.status <> 'draft' BEGIN SELECT RAISE(ABORT, 'site_config_version history is never deleted'); END",
    site_config_version_no_replace:
      "CREATE TRIGGER site_config_version_no_replace BEFORE INSERT ON site_config_version WHEN EXISTS (SELECT 1 FROM site_config_version WHERE id = NEW.id OR (site_id = NEW.site_id AND version = NEW.version) OR rowid = NEW.rowid OR (NEW.status = 'published' AND site_id = NEW.site_id AND status = 'published')) BEGIN SELECT RAISE(ABORT, 'site_config_version rows are never replaced'); END",
    site_config_version_positive_rowid:
      "CREATE TRIGGER site_config_version_positive_rowid AFTER INSERT ON site_config_version WHEN NEW.rowid < 1 BEGIN SELECT RAISE(ABORT, 'site_config_version rowids are positive'); END",
  };

/** Refuses to serve (fails closed) unless every site_config_version trigger is present and unaltered. */
export function checkConfigVersionTriggers(db: Db): Promise<void> {
  return checkTriggers(
    db,
    ["site_config_version"],
    CONFIG_VERSION_TRIGGERS,
    CONFIG_VERSION_TRIGGER_SQL,
  );
}
