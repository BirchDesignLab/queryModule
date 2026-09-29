import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { sql } from "drizzle-orm";
import type { Clock } from "../clock";
import type { Db } from "../db/client";
import { withTransaction } from "../db/tx";
import { CANARY_GUARD_TABLES, type CanaryKeyName, writeCanary } from "../keys/canary";
import type { AuditService } from "../seams";

export const GUARD_TABLES = CANARY_GUARD_TABLES;
export class RunbookOutdatedError extends Error {
  constructor(readonly table: string) {
    super(`table ${table} exists: this runbook must first be extended to shred it (spec 8.7)`);
    this.name = "RunbookOutdatedError";
  }
}

/** PRAGMA wal_checkpoint(TRUNCATE) reports busy = 1 without an error when it could not finish. */
export function assertCheckpointComplete(row: Record<string, unknown> | undefined): void {
  if (!row || Number(row.busy) !== 0)
    throw new Error("WAL checkpoint busy: stop other database users and rerun the runbook");
}

/** Guard tables this runbook knows how to shred. Any other existing guard table is refused. */
const SHREDDABLE = new Set<string>(["request_key"]);
const SCOPES = ["values", "payload"] as const;

export interface LostKeyResult {
  keysDeleted: number;
  requestCount: number;
}

/**
 * Lost-key recovery (spec 8.7). For "data" it also shreds request_key when the table exists:
 * count per scope, delete every row, rewrite the canary and audit one retentionPurged per
 * scope (reason keyLost, SEC-021), all in one transaction, so an audit failure rolls the
 * whole shred back. "credential" refuses once state_credential exists.
 */
export async function recoverLostKey(
  db: Db,
  clock: Clock,
  keyName: CanaryKeyName,
  newKey: Buffer,
  audit?: AuditService,
): Promise<LostKeyResult> {
  const table = GUARD_TABLES[keyName];
  // The guard check and the canary write share one transaction, so a protected table created
  // in between cannot slip past the refusal (#217).
  const result = await withTransaction(db, async (tx) => {
    const exists = await tx.all(
      sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${table}`,
    );
    const out: LostKeyResult = { keysDeleted: 0, requestCount: 0 };
    if (exists.length > 0) {
      if (!SHREDDABLE.has(table)) throw new RunbookOutdatedError(table);
      if (!audit) throw new Error("an audit service is required to shred request_key (SEC-021)");
      const perScope = await tx.all<{ scope: string; keys: number; requests: number }>(
        sql`SELECT scope, count(*) AS keys, count(DISTINCT correlation_id) AS requests
            FROM request_key GROUP BY scope`,
      );
      const total = await tx.all<{ requests: number }>(
        sql`SELECT count(DISTINCT correlation_id) AS requests FROM request_key`,
      );
      out.requestCount = Number(total[0]?.requests ?? 0);
      await tx.run(sql`DELETE FROM request_key`);
      // One retentionPurged per scope whenever the table exists, zero counts included (spec 8.7).
      for (const scope of SCOPES) {
        const row = perScope.find((r) => r.scope === scope);
        const keysDeleted = row ? Number(row.keys) : 0;
        out.keysDeleted += keysDeleted;
        await audit.record(tx, {
          type: "retentionPurged",
          actor: SYSTEM_ACTOR,
          identitySource: "system",
          details: {
            scope,
            reason: "keyLost",
            olderThan: null,
            requestCount: row ? Number(row.requests) : 0,
            keysDeleted,
          },
        });
      }
    }
    await writeCanary(tx, newKey, keyName, clock);
    return out;
  });
  // The canary write is an upsert, so a rerun after a busy checkpoint is safe.
  const r = await db.$client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
  assertCheckpointComplete(r.rows[0]);
  return result;
}
