import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { sql } from "drizzle-orm";
import type { Clock } from "../clock";
import type { Db } from "../db/client";
import { withTransaction } from "../db/tx";

export interface BackupManifest {
  createdAt: string;
  files: { name: string; sha256: string; bytes: number }[];
  auditCount: number;
  auditMaxId: number;
}

/**
 * Takes an online, consistent, still-encrypted copy of the database (spec 8.6, NFR-003).
 * wal_checkpoint(TRUNCATE) folds the WAL back into the main file, then withTransaction opens
 * a write transaction (BEGIN IMMEDIATE) that holds the connection and the write lock for the
 * duration of the copy (other writers wait on busy_timeout, SEC-010), so the main file and
 * any remaining WAL are copied byte for byte, still encrypted under DB_ENCRYPTION_KEY
 * (SEC-006). The manifest carries the audit row count and max id for the restore test. The
 * transaction does no writes, so it commits (a no-op) rather than rolling back; either way
 * releases the lock, and withTransaction is the only sanctioned way to hold one outside
 * src/db (SEC-006 db-client.test.ts forbids a raw client transaction call elsewhere).
 *
 * outDir must resolve outside the live data directory (spec 8.6, NFR-003: the copy has to
 * land off the data volume). Checked here, against dbFile's own directory, rather than in the
 * CLI: a raw prefix check on the argv string (e.g. `out.startsWith("/data")`) is bypassable by
 * `..` traversal or a relative path, and it hardcodes "/data" instead of the configured
 * DATA_DIR (critic:C1).
 */
export async function takeBackup(
  db: Db,
  dbFile: string,
  outDir: string,
  clock: Clock,
): Promise<BackupManifest> {
  const dataDir = resolve(dirname(dbFile));
  const rel = relative(dataDir, resolve(outDir));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error("backup outDir must be outside the data dir");
  }
  mkdirSync(outDir, { recursive: true });
  await db.$client.execute("PRAGMA wal_checkpoint(TRUNCATE)");
  return withTransaction(db, async (tx) => {
    const row = await tx.get<{ n: number | bigint; m: number | bigint }>(
      sql`SELECT count(*) AS n, coalesce(max(id), 0) AS m FROM audit_event`,
    );
    const auditCount = Number(row?.n ?? 0);
    const auditMaxId = Number(row?.m ?? 0);
    const files: BackupManifest["files"] = [];
    for (const src of [dbFile, `${dbFile}-wal`]) {
      if (!existsSync(src)) continue;
      const name = basename(src);
      copyFileSync(src, join(outDir, name));
      const buf = readFileSync(join(outDir, name));
      files.push({
        name,
        sha256: createHash("sha256").update(buf).digest("hex"),
        bytes: buf.length,
      });
    }
    const m: BackupManifest = {
      createdAt: new Date(clock.now()).toISOString(),
      files,
      auditCount,
      auditMaxId,
    };
    writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(m, null, 2)}\n`);
    return m;
  });
}
