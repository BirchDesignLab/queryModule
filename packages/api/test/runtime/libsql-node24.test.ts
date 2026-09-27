import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { afterAll, describe, expect, it } from "vitest";

describe("ADR-0001 @libsql/client on Node 24", () => {
  const dir = mkdtempSync(join(tmpdir(), "qm-libsql-"));
  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // Windows: libsql's native handle keeps the file locked until the process
      // exits, so the OS-temp directory is left behind there; Linux still fails.
      if (process.platform !== "win32") throw e;
    }
  });

  it("runs on Node 24", () => {
    expect(Number(process.versions.node.split(".")[0])).toBe(24);
  });

  it("loads the native binding and queries an in-memory database", async () => {
    const db = createClient({ url: ":memory:" });
    const rs = await db.execute("select 1 as one");
    expect(rs.rows[0]?.one).toBe(1);
    db.close();
  });

  it("writes and reopens an encrypted file database with encryptionKey", async () => {
    const url = `file:${join(dir, "enc.db").replaceAll("\\", "/")}`;
    const key = "p0-compat-check-not-a-secret";
    const a = createClient({ url, encryptionKey: key });
    await a.execute("create table t (x integer)");
    await a.execute("insert into t values (7)");
    a.close();
    const b = createClient({ url, encryptionKey: key });
    const rs = await b.execute("select x from t");
    expect(rs.rows[0]?.x).toBe(7);
    b.close();
  });
});
