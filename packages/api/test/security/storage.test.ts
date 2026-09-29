import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { systemClock } from "../../src/clock";
import { DatabaseOpenError, type Db, openDatabase } from "../../src/db/client";
import {
  AUDIT_TRIGGER_SQL,
  AUDIT_TRIGGERS,
  AuditTriggerMissingError,
  checkAuditTriggers,
  checkQueryTriggers,
  QUERY_TRIGGER_SQL,
  QUERY_TRIGGERS,
  QueryTriggerMissingError,
  runMigrations,
} from "../../src/db/migrate";
import { requestKey } from "../../src/db/schema";
import { buildDeps } from "../../src/deps";
import { AeadError } from "../../src/keys/aead";
import { checkKeyCanaries, KeyCanaryError } from "../../src/keys/canary";
import { createRequestKeys, unwrapRequestKey } from "../../src/keys/request-keys";
import { openTempDatabase, TEST_DB_KEY, tempDbFile } from "../helpers/db";
import { migratedDb as migratedEnvDb, TEST_SECRETS, testEnv } from "../helpers/fixture";

const MIGRATIONS = resolve(import.meta.dirname, "../../drizzle");

async function migratedDb() {
  const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
  await runMigrations(db, MIGRATIONS);
  return db;
}

async function missingAfterDropping(dropped: readonly string[]): Promise<unknown> {
  const db = await migratedDb();
  try {
    for (const name of dropped) await db.$client.execute(`DROP TRIGGER ${name}`);
    return await checkAuditTriggers(db).catch((e: unknown) => e);
  } finally {
    db.$client.close();
  }
}

describe("storage: SEC-006, SEC-010", () => {
  it("opening the file without DB_ENCRYPTION_KEY fails", async () => {
    const file = tempDbFile();
    const db = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
    await runMigrations(db, MIGRATIONS);
    db.$client.close();
    // A client with no key reaches the file itself and finds no SQLite database in it:
    // SQLITE_NOTADB means the bytes on disk are ciphertext, not a plaintext database.
    const raw = createClient({ url: `file:${file}` });
    try {
      await expect(raw.execute("SELECT count(*) FROM sqlite_master")).rejects.toMatchObject({
        code: "SQLITE_NOTADB",
      });
    } finally {
      raw.close();
    }
  });

  it("openDatabase refuses an empty DB_ENCRYPTION_KEY", async () => {
    await expect(openDatabase({ file: tempDbFile(), encryptionKey: "" })).rejects.toThrow(
      DatabaseOpenError,
    );
  });

  it("migrations are idempotent and triggers are found", async () => {
    const db = await migratedDb();
    try {
      await runMigrations(db, MIGRATIONS);
      await expect(checkAuditTriggers(db)).resolves.toBeUndefined();
    } finally {
      db.$client.close();
    }
  });

  it("requires the update, delete and replace triggers", () => {
    expect(AUDIT_TRIGGERS).toEqual([
      "audit_event_no_update",
      "audit_event_no_delete",
      "audit_event_no_replace",
    ]);
  });

  it.each(AUDIT_TRIGGERS)("a dropped %s makes the check refuse", async (name) => {
    const err = await missingAfterDropping([name]);
    expect(err).toBeInstanceOf(AuditTriggerMissingError);
    expect((err as AuditTriggerMissingError).missing).toEqual([name]);
    expect((err as AuditTriggerMissingError).message).toContain(name);
  });

  it("names every missing trigger, in AUDIT_TRIGGERS order", async () => {
    const err = await missingAfterDropping([...AUDIT_TRIGGERS].reverse());
    expect(err).toBeInstanceOf(AuditTriggerMissingError);
    expect((err as AuditTriggerMissingError).missing).toEqual([...AUDIT_TRIGGERS]);
  });

  it("an unmigrated database fails the check", async () => {
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    try {
      const err = await checkAuditTriggers(db).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuditTriggerMissingError);
      expect((err as AuditTriggerMissingError).missing).toEqual([...AUDIT_TRIGGERS]);
    } finally {
      db.$client.close();
    }
  });

  it("a same-named trigger on another table does not count", async () => {
    const db = await migratedDb();
    try {
      await db.$client.execute("DROP TRIGGER audit_event_no_replace");
      await db.$client.execute("CREATE TABLE decoy (id INTEGER)");
      await db.$client.execute(
        "CREATE TRIGGER audit_event_no_replace BEFORE INSERT ON decoy BEGIN SELECT 1; END",
      );
      const err = await checkAuditTriggers(db).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuditTriggerMissingError);
      expect((err as AuditTriggerMissingError).missing).toEqual(["audit_event_no_replace"]);
    } finally {
      db.$client.close();
    }
  });

  it("pins each trigger's statement to migration 0001", () => {
    const file = readFileSync(resolve(MIGRATIONS, "0001_audit_triggers.sql"), "utf8");
    const statements = file
      .split("--> statement-breakpoint")
      .map((st) => st.replace(/\s+/g, " ").trim().replace(/;$/, ""));
    expect(statements).toEqual(AUDIT_TRIGGERS.map((t) => AUDIT_TRIGGER_SQL[t]));
  });

  it.each(AUDIT_TRIGGERS)(
    "a same-named %s with a rewritten body makes the check refuse",
    async (name) => {
      const db = await migratedDb();
      try {
        await db.$client.execute(`DROP TRIGGER ${name}`);
        await db.$client.execute(
          `CREATE TRIGGER ${name} BEFORE UPDATE ON audit_event BEGIN SELECT 1; END`,
        );
        const err = await checkAuditTriggers(db).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AuditTriggerMissingError);
        expect((err as AuditTriggerMissingError).missing).toEqual([]);
        expect((err as AuditTriggerMissingError).altered).toEqual([name]);
        expect((err as AuditTriggerMissingError).message).toContain(name);
      } finally {
        db.$client.close();
      }
    },
  );

  it("a trigger body rewritten through writable_schema makes the check refuse", async () => {
    // The app connection refuses writable_schema (#189), so the tamper comes out of band:
    // a raw libsql client with the key, on the same file.
    const file = tempDbFile();
    const db = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
    await runMigrations(db, MIGRATIONS);
    const raw = createClient({ url: `file:${file}`, encryptionKey: TEST_DB_KEY });
    try {
      await raw.execute("PRAGMA writable_schema = ON");
      await raw.execute(
        "UPDATE sqlite_master SET sql = 'CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event BEGIN SELECT 1; END' WHERE type = 'trigger' AND name = 'audit_event_no_delete'",
      );
      await raw.execute("PRAGMA writable_schema = OFF");
      raw.close();
      const err = await checkAuditTriggers(db).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuditTriggerMissingError);
      expect((err as AuditTriggerMissingError).altered).toEqual(["audit_event_no_delete"]);
    } finally {
      if (!raw.closed) raw.close();
      db.$client.close();
    }
  });
});

describe("storage: key canaries", () => {
  const keys = { credentialKey: Buffer.alloc(32, 2), dataKey: Buffer.alloc(32, 3) };
  it("a mismatched CREDENTIAL_KEY fails the canary", async () => {
    const db = await openTempDatabase();
    await runMigrations(db, MIGRATIONS);
    await checkKeyCanaries(db, keys, systemClock);
    const err = await checkKeyCanaries(
      db,
      { ...keys, credentialKey: Buffer.alloc(32, 7) },
      systemClock,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyCanaryError);
    expect((err as KeyCanaryError).keyName).toBe("credential");
  });
  it("a mismatched DATA_KEY fails the canary and names only data", async () => {
    const db = await openTempDatabase();
    await runMigrations(db, MIGRATIONS);
    await checkKeyCanaries(db, keys, systemClock);
    const err = await checkKeyCanaries(
      db,
      { ...keys, dataKey: Buffer.alloc(32, 8) },
      systemClock,
    ).catch((e: unknown) => e);
    expect((err as KeyCanaryError).keyName).toBe("data");
  });
});

describe("storage: DATA_KEY and request_key (SEC-006, spec 10.3)", () => {
  it("a request_key row written under DATA_KEY A fails to unwrap under B; the credential canary still opens", async () => {
    const keysA = { credentialKey: Buffer.alloc(32, 2), dataKey: Buffer.alloc(32, 3) };
    const dataKeyB = Buffer.alloc(32, 9);
    const db = await openTempDatabase();
    await runMigrations(db, MIGRATIONS);
    await checkKeyCanaries(db, keysA, systemClock);
    const cid = "01890a5d-ac96-774b-bcce-b302099a8057";
    const { rows, deks } = createRequestKeys(keysA.dataKey, cid, 1_790_000_000_000);
    await db.insert(requestKey).values(rows);
    const stored = await db.select().from(requestKey).where(eq(requestKey.correlationId, cid));
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      expect(unwrapRequestKey(keysA.dataKey, row).equals(deks[row.scope])).toBe(true);
      expect(() => unwrapRequestKey(dataKeyB, row)).toThrow(AeadError);
    }
    // The credential canary is checked first and opens; only DATA_KEY is refused.
    const err = await checkKeyCanaries(db, { ...keysA, dataKey: dataKeyB }, systemClock).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(KeyCanaryError);
    expect((err as KeyCanaryError).keyName).toBe("data");
  });
});

const CID = "01890a5d-ac96-774b-bcce-b302099a8057";
async function insertQueryRequest(
  db: Db,
  partId: number,
  idempotencyKey: string | null,
  cid = CID,
) {
  await db.$client.execute({
    sql: `INSERT INTO query_request (correlation_id, part_id, user_id, origin, query_type, type_values,
      plate_only, selected_source_ids, dropped_source_ids, config_hash, idempotency_key, submitted_at)
      VALUES (?, ?, 'u1', ?, 'vehicle', '{}', 0, '["s1"]', '[]', 'h1', ?, 1)`,
    args: [cid, partId, partId === 0 ? "primary" : "alsoRun", idempotencyKey],
  });
}
async function insertPendingResult(db: Db, resultId: string, partId = 0) {
  await db.$client.execute({
    sql: `INSERT INTO source_result (result_id, correlation_id, part_id, source_id, user_id, status,
      adapter_kind, created_at) VALUES (?, ?, ?, 's1', 'u1', 'pending', 'mock', 1)`,
    args: [resultId, CID, partId],
  });
}
async function queryDb() {
  const db = await migratedDb();
  await insertQueryRequest(db, 0, "idem-1");
  await insertPendingResult(db, "r1");
  return db;
}
const setStatus = (db: Db, from: string, to: string) =>
  db.$client.execute({
    sql: "UPDATE source_result SET status = ?, received_at = 2 WHERE result_id = 'r1' AND status = ?",
    args: [to, from],
  });

describe("SEC-013 query rows are insert-once and write-once", () => {
  it("UPDATE query_request aborts", async () => {
    const db = await queryDb();
    try {
      await expect(db.$client.execute("UPDATE query_request SET query_type = 'x'")).rejects.toThrow(
        /query_request is insert-once/,
      );
    } finally {
      db.$client.close();
    }
  });
  it("DELETE FROM source_result aborts", async () => {
    const db = await queryDb();
    try {
      await expect(db.$client.execute("DELETE FROM source_result")).rejects.toThrow(
        /never deleted/,
      );
    } finally {
      db.$client.close();
    }
  });
  it("pending -> returned succeeds once, then returned -> failed aborts", async () => {
    const db = await queryDb();
    try {
      expect((await setStatus(db, "pending", "returned")).rowsAffected).toBe(1);
      await expect(
        db.$client.execute("UPDATE source_result SET status = 'failed' WHERE result_id = 'r1'"),
      ).rejects.toThrow(/write-once from pending/);
      const row = (await db.$client.execute("SELECT status FROM source_result")).rows[0];
      expect(row?.status).toBe("returned");
    } finally {
      db.$client.close();
    }
  });
  it("pending -> pending aborts", async () => {
    const db = await queryDb();
    try {
      await expect(setStatus(db, "pending", "pending")).rejects.toThrow(/write-once from pending/);
    } finally {
      db.$client.close();
    }
  });
  it.each([
    ["result_id", "'r2'"],
    ["correlation_id", "'c2'"],
    ["part_id", "1"],
    ["source_id", "'s2'"],
    ["user_id", "'u2'"],
    ["credential_user_id", "'u2'"],
    ["delegation_id", "'d1'"],
    ["adapter_kind", "'other'"],
    ["created_at", "5"],
  ])("changing %s on a pending row aborts", async (column, value) => {
    const db = await queryDb();
    try {
      await expect(
        db.$client.execute(
          `UPDATE source_result SET status = 'returned', ${column} = ${value} WHERE result_id = 'r1'`,
        ),
      ).rejects.toThrow(/write-once from pending/);
    } finally {
      db.$client.close();
    }
  });
  it("INSERT OR REPLACE on an existing query_request aborts and leaves the row", async () => {
    const db = await queryDb();
    try {
      await expect(
        db.$client.execute({
          sql: `INSERT OR REPLACE INTO query_request (correlation_id, part_id, user_id, origin,
            query_type, type_values, plate_only, selected_source_ids, dropped_source_ids, config_hash,
            idempotency_key, submitted_at)
            VALUES (?, 0, 'u2', 'primary', 'person', '{}', 0, '[]', '[]', 'h2', 'idem-2', 9)`,
          args: [CID],
        }),
      ).rejects.toThrow(/query_request is insert-once/);
      const rows = (await db.$client.execute("SELECT user_id, query_type FROM query_request")).rows;
      expect(rows.map((r) => [r.user_id, r.query_type])).toEqual([["u1", "vehicle"]]);
    } finally {
      db.$client.close();
    }
  });
  it.each([
    ["the same result_id", "r1"],
    ["a new result_id on the same (correlation_id, part_id, source_id)", "r9"],
  ])("INSERT OR REPLACE on source_result with %s aborts and leaves the row", async (_, rid) => {
    const db = await queryDb();
    try {
      expect((await setStatus(db, "pending", "returned")).rowsAffected).toBe(1);
      await expect(
        db.$client.execute({
          sql: `INSERT OR REPLACE INTO source_result (result_id, correlation_id, part_id, source_id,
            user_id, status, adapter_kind, created_at) VALUES (?, ?, 0, 's1', 'u2', 'failed', 'mock', 1)`,
          args: [rid, CID],
        }),
      ).rejects.toThrow(/source_result rows are never replaced/);
      const rows = (
        await db.$client.execute("SELECT result_id, user_id, status FROM source_result")
      ).rows;
      expect(rows.map((r) => [r.result_id, r.user_id, r.status])).toEqual([
        ["r1", "u1", "returned"],
      ]);
    } finally {
      db.$client.close();
    }
  });
  it("DELETE of a child-less query_request aborts even with foreign_keys off", async () => {
    const db = await queryDb();
    try {
      await insertQueryRequest(db, 1, null);
      await db.$client.execute("PRAGMA foreign_keys = OFF");
      await expect(
        db.$client.execute("DELETE FROM query_request WHERE part_id = 1"),
      ).rejects.toThrow(/query_request rows are never deleted/);
      const n = (await db.$client.execute("SELECT count(*) AS n FROM query_request")).rows[0]?.n;
      expect(Number(n)).toBe(2);
    } finally {
      db.$client.close();
    }
  });
  it("a source_result without its query_request fails the foreign key", async () => {
    const db = await migratedDb();
    try {
      await expect(insertPendingResult(db, "r-orphan")).rejects.toThrow(/FOREIGN KEY/);
    } finally {
      db.$client.close();
    }
  });
  it("part 0 idempotency keys are unique per user; part rows with a null key coexist", async () => {
    const db = await queryDb();
    try {
      await expect(
        insertQueryRequest(db, 0, "idem-1", "01890a5d-ac96-774b-bcce-b302099a8058"),
      ).rejects.toThrow(/UNIQUE constraint failed/);
      await insertQueryRequest(db, 1, null);
      await insertQueryRequest(db, 2, null);
      const n = (await db.$client.execute("SELECT count(*) AS n FROM query_request")).rows[0]?.n;
      expect(Number(n)).toBe(3);
    } finally {
      db.$client.close();
    }
  });

  it("migrations leave every query trigger present and unaltered", async () => {
    const db = await migratedDb();
    try {
      await expect(checkQueryTriggers(db)).resolves.toBeUndefined();
    } finally {
      db.$client.close();
    }
  });
  it("pins each query trigger's statement to migrations 0004 and 0005", () => {
    const statements = ["0004_query_triggers.sql", "0005_query_no_replace.sql"].flatMap((f) =>
      readFileSync(resolve(MIGRATIONS, f), "utf8")
        .split("--> statement-breakpoint")
        .map((st) => st.replace(/\s+/g, " ").trim().replace(/;$/, "")),
    );
    expect(statements).toEqual(QUERY_TRIGGERS.map((t) => QUERY_TRIGGER_SQL[t]));
  });
  it.each(QUERY_TRIGGERS)("a dropped %s makes the check refuse", async (name) => {
    const db = await migratedDb();
    try {
      await db.$client.execute(`DROP TRIGGER ${name}`);
      const err = await checkQueryTriggers(db).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(QueryTriggerMissingError);
      expect((err as QueryTriggerMissingError).missing).toEqual([name]);
      expect((err as QueryTriggerMissingError).message).toContain(name);
    } finally {
      db.$client.close();
    }
  });
  it("a same-named trigger with a rewritten body makes the check refuse", async () => {
    const db = await migratedDb();
    try {
      await db.$client.execute("DROP TRIGGER source_result_no_delete");
      await db.$client.execute(
        "CREATE TRIGGER source_result_no_delete BEFORE DELETE ON source_result BEGIN SELECT 1; END",
      );
      const err = await checkQueryTriggers(db).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(QueryTriggerMissingError);
      expect((err as QueryTriggerMissingError).missing).toEqual([]);
      expect((err as QueryTriggerMissingError).altered).toEqual(["source_result_no_delete"]);
    } finally {
      db.$client.close();
    }
  });
  it("dropping source_result_write_once makes buildDeps throw QueryTriggerMissingError", async () => {
    const env = testEnv();
    const db = await migratedEnvDb(env);
    await db.$client.execute("DROP TRIGGER source_result_write_once");
    db.$client.close();
    const err = await buildDeps({ env, secrets: TEST_SECRETS }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QueryTriggerMissingError);
    expect((err as QueryTriggerMissingError).missing).toEqual(["source_result_write_once"]);
  });
});
