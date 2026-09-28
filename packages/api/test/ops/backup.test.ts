import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client";
import { withTransaction } from "../../src/db/tx";
import { auditStats } from "../../src/ops/audit-stats";
import { takeBackup } from "../../src/ops/backup";
import { TEST_SECRETS } from "../helpers/fixture";
import { createTestApp } from "../helpers/test-app";

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
    const out = mkdtempSync(join(tmpdir(), "qm-backup-"));
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
    await takeBackup(t.deps.db, t.env.dbFile, mkdtempSync(join(tmpdir(), "qm-backup-")), t.clock);
    await expect(
      withTransaction(t.deps.db, async (tx) => {
        await tx.run(sql`INSERT INTO rate_limit (key, window_start, count) VALUES ('after', 1, 1)`);
      }),
    ).resolves.toBeUndefined();
  });
});
