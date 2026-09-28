import { sql } from "drizzle-orm";
import type { Clock } from "../clock";
import type { Db } from "../db/client";
import { withTransaction } from "../db/tx";
import { CANARY_GUARD_TABLES, type CanaryKeyName, writeCanary } from "../keys/canary";

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

export async function recoverLostKey(
  db: Db,
  clock: Clock,
  keyName: CanaryKeyName,
  newKey: Buffer,
): Promise<void> {
  const table = GUARD_TABLES[keyName];
  // The guard check and the canary write share one transaction, so a protected table created
  // in between cannot slip past the refusal (#217).
  await withTransaction(db, async (tx) => {
    const exists = await tx.all(
      sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${table}`,
    );
    if (exists.length > 0) throw new RunbookOutdatedError(table);
    await writeCanary(tx, newKey, keyName, clock);
  });
  // The canary write is an upsert, so a rerun after a busy checkpoint is safe.
  const r = await db.$client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
  assertCheckpointComplete(r.rows[0]);
}
