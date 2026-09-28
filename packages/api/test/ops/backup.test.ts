import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client";
import { withTransaction } from "../../src/db/tx";
import { auditStats } from "../../src/ops/audit-stats";
import { takeBackup } from "../../src/ops/backup";
import { TEST_SECRETS } from "../helpers/fixture";
import { createTestApp } from "../helpers/test-app";

// mkdtempSync backup output dirs, removed once the test that made them finishes (any copy
// client using the dir must already be closed by then; controller ruling 09-28-26).
const backupDirs: string[] = [];
afterEach(() => {
  for (const dir of backupDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort; matches test/helpers/db.ts's tolerance for a still-locked Windows handle
    }
  }
});
function mkBackupDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "qm-backup-"));
  backupDirs.push(dir);
  return dir;
}

describe("NFR-003 online encrypted backup", () => {
  it("copies an encrypted, consistent database with a matching manifest", async () => {
    const t = await createTestApp();
    for (let i = 0; i < 4; i++) {
      await withTransaction(t.deps.db, (tx) =>
        t.deps.audit.record(tx, {
          type: "loginFailed",
          actor: SYSTEM_ACTOR,
          identitySource: "system",
          details: { targetUserId: null, reason: "unknownAccount", clientIp: "local" },
        }),
      );
    }
    const out = mkBackupDir();
    const m = await takeBackup(t.deps.db, t.env.dbFile, out, t.clock);
    expect(m).toMatchObject({ auditCount: 4, auditMaxId: 4 });
    for (const f of m.files)
      expect(
        createHash("sha256")
          .update(readFileSync(join(out, f.name)))
          .digest("hex"),
      ).toBe(f.sha256);
    expect(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"))).toEqual(m);
    const copy = await openDatabase({
      file: join(out, "querymodule.db"),
      encryptionKey: TEST_SECRETS.dbEncryptionKey,
    });
    expect(await auditStats(copy)).toEqual({ auditCount: 4, auditMaxId: 4 });
    expect((await copy.$client.execute("PRAGMA integrity_check")).rows[0]?.integrity_check).toBe(
      "ok",
    );
    copy.$client.close();
    await expect(
      openDatabase({
        file: join(out, "querymodule.db"),
        encryptionKey: "wrong-key-wrong-key-wrong-key-wrong",
      }),
    ).rejects.toThrow();
  });
  it("releases the write lock afterwards", async () => {
    const t = await createTestApp();
    await takeBackup(t.deps.db, t.env.dbFile, mkBackupDir(), t.clock);
    await expect(
      withTransaction(t.deps.db, async (tx) => {
        await tx.run(sql`INSERT INTO rate_limit (key, window_start, count) VALUES ('after', 1, 1)`);
      }),
    ).resolves.toBeUndefined();
  });
});

describe("takeBackup outDir guard (critic:C1)", () => {
  it("refuses an outDir equal to the data dir", async () => {
    const t = await createTestApp();
    await expect(takeBackup(t.deps.db, t.env.dbFile, t.env.dataDir, t.clock)).rejects.toThrow();
  });

  it("refuses a data-dir child whose name starts with two dots (#217 G-m1)", async () => {
    const t = await createTestApp();
    await expect(
      takeBackup(t.deps.db, t.env.dbFile, join(t.env.dataDir, "..x"), t.clock),
    ).rejects.toThrow(/outside the data dir/);
  });
  it("refuses an outDir that is a subdirectory of the data dir", async () => {
    const t = await createTestApp();
    await expect(
      takeBackup(t.deps.db, t.env.dbFile, join(t.env.dataDir, "sub"), t.clock),
    ).rejects.toThrow();
  });

  it("refuses a traversal outDir that resolves back inside the data dir", async () => {
    const t = await createTestApp();
    const dataDirName = t.env.dataDir.split(/[\\/]/).pop();
    const traversal = join(t.env.dataDir, "..", dataDirName ?? "", "x");
    await expect(takeBackup(t.deps.db, t.env.dbFile, traversal, t.clock)).rejects.toThrow();
  });

  it("refuses an outDir given with a trailing slash equal to the data dir", async () => {
    const t = await createTestApp();
    await expect(
      takeBackup(t.deps.db, t.env.dbFile, `${t.env.dataDir}/`, t.clock),
    ).rejects.toThrow();
  });

  it("accepts a sibling directory of the data dir", async () => {
    const t = await createTestApp();
    const out = `${t.env.dataDir}2`;
    backupDirs.push(out);
    await expect(takeBackup(t.deps.db, t.env.dbFile, out, t.clock)).resolves.toBeDefined();
  });

  it("accepts an outDir outside the data dir (existing coverage via mkBackupDir)", async () => {
    const t = await createTestApp();
    await expect(
      takeBackup(t.deps.db, t.env.dbFile, mkBackupDir(), t.clock),
    ).resolves.toBeDefined();
  });
});
