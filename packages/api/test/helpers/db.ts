import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_DB_KEY = "test-db-key-0123456789abcdef0123456789";
export function tempDbFile(): string {
  return join(mkdtempSync(join(tmpdir(), "qm-db-")), "querymodule.db");
}
