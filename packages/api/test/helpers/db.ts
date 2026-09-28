import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

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

afterAll(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDbFile(): string {
  const dir = mkdtempSync(join(TEST_DB_ROOT, "qm-db-"));
  created.push(dir);
  return join(dir, "querymodule.db");
}
