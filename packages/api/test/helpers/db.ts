import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect } from "vitest";
import { type Db, openDatabase } from "../../src/db/client";
import { removeTempDirs, sweepStaleTempDirs } from "./temp-dirs";

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

afterAll(() => {
  closeAll(openClients.splice(0));
  removeTempDirs(created.splice(0), "test/helpers/db");
});

export { sweepStaleTempDirs };

// A prior Windows run may have left qm-db-* dirs behind (see removeTempDirs in ./temp-dirs); sweep
// anything older than 10 minutes so TEST_DB_ROOT does not pile up. Never on the critical path.
sweepStaleTempDirs(TEST_DB_ROOT, 10 * 60 * 1000);

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
