import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect } from "vitest";
import { type Db, openDatabase } from "../../src/db/client";

export const TEST_DB_KEY = "test-db-key-0123456789abcdef0123456789";

/**
 * Test databases live on tmpfs where the host has one. The database runs synchronous = FULL,
 * so every commit fsyncs; on a disk those fsyncs queue behind the rest of the parallel suite
 * and a 20-commit test could pass the 5 s test timeout. tmpfs keeps the pragmas and makes the
 * fsync free; other hosts fall back to the OS temp directory. Each test file removes its own
 * directories when it finishes, so tmpfs (memory) does not fill up across runs.
 */
const TEST_DB_ROOT = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();
const created: string[] = [];
const openClients: Client[] = [];

interface Client {
  closed: boolean;
  close(): void;
}

/** Closes every tracked client, then asserts each one actually reports closed. */
export function closeAll(clients: readonly Client[]): void {
  for (const client of clients) if (!client.closed) client.close();
  for (const client of clients) expect(client.closed).toBe(true);
}

/*
 * A bare libsql client, closed right after open, can still hold its Windows file handle for
 * several seconds afterward (observed here: ~4.5-5.5s, Defender exclusion or not — the actual
 * holder is unclear, could be the native libsql close path itself). No retry budget worth
 * paying on every test run closes that gap, so on win32 a still-locked dir is left in place
 * (one summary warning per file) instead of failing it; the next run's sweep below clears it.
 * Every other platform, and every other rmSync error, still throws. The real leak check is
 * closeAll's assertion above, which runs everywhere including Linux CI.
 */
afterAll(() => {
  closeAll(openClients.splice(0));
  const dirs = created.splice(0);
  let stuck = 0;
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if (process.platform !== "win32") throw e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY") throw e;
      stuck++;
    }
  }
  if (stuck > 0) {
    console.warn(`[test/helpers/db] ${stuck} temp dir(s) left for the next run's sweep`);
  }
});

/** Removes qm-db-* dirs under root older than maxAgeMs. Best-effort: failures are ignored. */
export function sweepStaleTempDirs(root: string, maxAgeMs: number, now = Date.now()): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith("qm-db-")) continue;
    const dir = join(root, name);
    try {
      if (now - statSync(dir).mtimeMs > maxAgeMs) rmSync(dir, { recursive: true, force: true });
    } catch {
      // still locked or already gone; leave it for a later run
    }
  }
}

// A prior Windows run may have left qm-db-* dirs behind (see the afterAll comment above); sweep
// anything older than 10 minutes so %TEMP% does not pile up. Never on the critical path.
sweepStaleTempDirs(tmpdir(), 10 * 60 * 1000);

export function tempDbFile(): string {
  const dir = mkdtempSync(join(TEST_DB_ROOT, "qm-db-"));
  created.push(dir);
  return join(dir, "querymodule.db");
}

/** Opens a database on a fresh tempDbFile() and closes it automatically in afterAll. */
export async function openTempDatabase(o?: { file?: string; encryptionKey?: string }): Promise<Db> {
  const db = await openDatabase({
    file: o?.file ?? tempDbFile(),
    encryptionKey: o?.encryptionKey ?? TEST_DB_KEY,
  });
  openClients.push(db.$client);
  return db;
}
