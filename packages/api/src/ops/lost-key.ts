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

export async function recoverLostKey(
  db: Db,
  clock: Clock,
  keyName: CanaryKeyName,
  newKey: Buffer,
): Promise<void> {
  const table = GUARD_TABLES[keyName];
  const exists = await db.$client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  if (exists.rows.length > 0) throw new RunbookOutdatedError(table);
  await withTransaction(db, (tx) => writeCanary(tx, newKey, keyName, clock));
  await db.$client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
}
