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
  checkAuditTriggers,
  checkQueryTriggers,
  QUERY_TRIGGER_SQL,
  QUERY_TRIGGERS,
  runMigrations,
  TriggerMissingError,
} from "../../src/db/migrate";
import { requestKey } from "../../src/db/schema";
import { buildDeps } from "../../src/deps";
import { AeadError } from "../../src/keys/aead";
import { checkKeyCanaries, KeyCanaryError } from "../../src/keys/canary";
import { createRequestKeys, unwrapRequestKey } from "../../src/keys/request-keys";
import { TEST_DB_KEY, tempDbFile } from "../helpers/db";
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
    expect(err).toBeInstanceOf(TriggerMissingError);
    expect((err as TriggerMissingError).missing).toEqual([name]);
    expect((err as TriggerMissingError).tables).toEqual(["audit_event"]);
    expect((err as TriggerMissingError).message).toBe(`audit_event triggers missing: ${name}`);
  });

  it("names every missing trigger, in AUDIT_TRIGGERS order", async () => {
    const err = await missingAfterDropping([...AUDIT_TRIGGERS].reverse());
    expect(err).toBeInstanceOf(TriggerMissingError);
    expect((err as TriggerMissingError).missing).toEqual([...AUDIT_TRIGGERS]);
  });

  it("an unmigrated database fails the check", async () => {
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    try {
      const err = await checkAuditTriggers(db).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TriggerMissingError);
      expect((err as TriggerMissingError).missing).toEqual([...AUDIT_TRIGGERS]);
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
      expect(err).toBeInstanceOf(TriggerMissingError);
      expect((err as TriggerMissingError).missing).toEqual(["audit_event_no_replace"]);
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
        expect(err).toBeInstanceOf(TriggerMissingError);
        expect((err as TriggerMissingError).missing).toEqual([]);
        expect((err as TriggerMissingError).altered).toEqual([name]);
        expect((err as TriggerMissingError).message).toContain(name);
      } finally {
        db.$client.close();
      }
    },
  );

  it("a trigger body rewritten through writable_schema makes the check refuse", async () => {
    // The app connection refuses writable_schema (#189), so the tamper comes out of band:
    // a raw libsql client with the key, on the same file.
    // The app connection is closed before the raw client opens and the check runs on a fresh
    // app connection after the raw one closed, so the two never hold the file at once and the
    // result does not depend on concurrent-open timing (#311 Task 14).
    const file = tempDbFile();
    const setup = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
    try {
      await runMigrations(setup, MIGRATIONS);
    } finally {
      setup.$client.close();
    }
    const raw = createClient({ url: `file:${file}`, encryptionKey: TEST_DB_KEY });
    try {
      await raw.execute("PRAGMA writable_schema = ON");
      await raw.execute(
        "UPDATE sqlite_master SET sql = 'CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event BEGIN SELECT 1; END' WHERE type = 'trigger' AND name = 'audit_event_no_delete'",
      );
      await raw.execute("PRAGMA writable_schema = OFF");
    } finally {
      raw.close();
    }
    const db = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
    try {
      const err = await checkAuditTriggers(db).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TriggerMissingError);
      expect((err as TriggerMissingError).altered).toEqual(["audit_event_no_delete"]);
    } finally {
      db.$client.close();
    }
  });
});

/** The canary refusal message: fixed text naming the key, never key bytes in any encoding (spec 5.9). */
function expectNoKeyMaterial(message: string, keys: readonly Buffer[]) {
  for (const key of keys) {
    for (const enc of ["base64", "base64url", "hex"] as const) {
      expect(message).not.toContain(key.toString(enc));
    }
  }
}

describe("storage: key canaries (spec 10.3)", () => {
  const keys = { credentialKey: Buffer.alloc(32, 2), dataKey: Buffer.alloc(32, 3) };
  it("a mismatched CREDENTIAL_KEY fails the canary, names CREDENTIAL_KEY and carries no key material", async () => {
    const db = await migratedDb();
    try {
      await checkKeyCanaries(db, keys, systemClock);
      const wrong = Buffer.alloc(32, 7);
      const err = await checkKeyCanaries(db, { ...keys, credentialKey: wrong }, systemClock).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(KeyCanaryError);
      expect((err as KeyCanaryError).keyName).toBe("credential");
      expect((err as Error).message).toBe("key canary for CREDENTIAL_KEY does not decrypt");
      expectNoKeyMaterial((err as Error).message, [keys.credentialKey, keys.dataKey, wrong]);
    } finally {
      db.$client.close();
    }
  });
  it("a mismatched DATA_KEY fails the canary, names only DATA_KEY and carries no key material", async () => {
    const db = await migratedDb();
    try {
      await checkKeyCanaries(db, keys, systemClock);
      const wrong = Buffer.alloc(32, 8);
      const err = await checkKeyCanaries(db, { ...keys, dataKey: wrong }, systemClock).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(KeyCanaryError);
      expect((err as KeyCanaryError).keyName).toBe("data");
      expect((err as Error).message).toBe("key canary for DATA_KEY does not decrypt");
      expectNoKeyMaterial((err as Error).message, [keys.credentialKey, keys.dataKey, wrong]);
    } finally {
      db.$client.close();
    }
  });
});

describe("storage: DATA_KEY and request_key (SEC-006, spec 10.3)", () => {
  it("a request_key row written under DATA_KEY A fails to unwrap under B; the credential canary still opens", async () => {
    const keysA = { credentialKey: Buffer.alloc(32, 2), dataKey: Buffer.alloc(32, 3) };
    const dataKeyB = Buffer.alloc(32, 9);
    const db = await migratedDb();
    try {
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
      // The credential canary is checked first: a wrong CREDENTIAL_KEY is named before DATA_KEY,
      // so "data" below means the credential canary opened under CREDENTIAL_KEY A.
      const both = await checkKeyCanaries(
        db,
        { credentialKey: Buffer.alloc(32, 7), dataKey: dataKeyB },
        systemClock,
      ).catch((e: unknown) => e);
      expect((both as KeyCanaryError).keyName).toBe("credential");
      const err = await checkKeyCanaries(db, { ...keysA, dataKey: dataKeyB }, systemClock).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(KeyCanaryError);
      expect((err as KeyCanaryError).keyName).toBe("data");
      // Neither refused check replaced a canary: under keys A both still open.
      await expect(checkKeyCanaries(db, keysA, systemClock)).resolves.toEqual({
        credential: "verified",
        data: "verified",
      });
    } finally {
      db.$client.close();
    }
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
  it("INSERT OR REPLACE on an existing query_request's rowid aborts and leaves the row (#279 C-I1)", async () => {
    const db = await queryDb();
    try {
      await insertQueryRequest(db, 1, null);
      const rowid = (
        await db.$client.execute("SELECT rowid AS r FROM query_request WHERE part_id = 1")
      ).rows[0]?.r;
      await expect(
        db.$client.execute({
          sql: `INSERT OR REPLACE INTO query_request (rowid, correlation_id, part_id, user_id, origin,
            query_type, type_values, plate_only, selected_source_ids, dropped_source_ids, config_hash,
            idempotency_key, submitted_at)
            VALUES (?, 'c9', 0, 'u2', 'primary', 'person', '{}', 0, '[]', '[]', 'h2', 'idem-9', 9)`,
          args: [Number(rowid)],
        }),
      ).rejects.toThrow(/query_request is insert-once/);
      const rows = (
        await db.$client.execute(
          "SELECT correlation_id, part_id FROM query_request ORDER BY part_id",
        )
      ).rows;
      expect(rows.map((r) => [r.correlation_id, r.part_id])).toEqual([
        [CID, 0],
        [CID, 1],
      ]);
    } finally {
      db.$client.close();
    }
  });
  it("INSERT OR REPLACE on an existing source_result's rowid aborts and leaves the row (#279 C-I1)", async () => {
    const db = await queryDb();
    try {
      expect((await setStatus(db, "pending", "returned")).rowsAffected).toBe(1);
      const rowid = (await db.$client.execute("SELECT rowid AS r FROM source_result")).rows[0]?.r;
      await expect(
        db.$client.execute({
          sql: `INSERT OR REPLACE INTO source_result (rowid, result_id, correlation_id, part_id,
            source_id, user_id, status, adapter_kind, created_at)
            VALUES (?, 'r2', ?, 0, 's2', 'u1', 'pending', 'mock', 1)`,
          args: [Number(rowid), CID],
        }),
      ).rejects.toThrow(/source_result rows are never replaced/);
      const rows = (await db.$client.execute("SELECT result_id, status FROM source_result")).rows;
      expect(rows.map((r) => [r.result_id, r.status])).toEqual([["r1", "returned"]]);
    } finally {
      db.$client.close();
    }
  });
  it("INSERT OR REPLACE through the idempotency index aborts and leaves a child-less request (#279 C-I2)", async () => {
    const db = await migratedDb();
    try {
      await insertQueryRequest(db, 0, "idem-1");
      await expect(
        db.$client.execute({
          sql: `INSERT OR REPLACE INTO query_request (correlation_id, part_id, user_id, origin,
            query_type, type_values, plate_only, selected_source_ids, dropped_source_ids, config_hash,
            idempotency_key, submitted_at)
            VALUES ('c2', 0, 'u1', 'primary', 'person', '{}', 0, '[]', '[]', 'h2', 'idem-1', 9)`,
          args: [],
        }),
      ).rejects.toThrow(/query_request idempotency key exists/);
      const rows = (await db.$client.execute("SELECT correlation_id FROM query_request")).rows;
      expect(rows.map((r) => r.correlation_id)).toEqual([CID]);
    } finally {
      db.$client.close();
    }
  });
  it("UPDATE OR REPLACE moving a pending source_result onto another row's rowid aborts and deletes nothing (#279 rr:N1)", async () => {
    const db = await queryDb();
    try {
      expect((await setStatus(db, "pending", "returned")).rowsAffected).toBe(1);
      await insertQueryRequest(db, 1, null);
      await insertPendingResult(db, "r2", 1);
      const r1 = (
        await db.$client.execute("SELECT rowid AS r FROM source_result WHERE result_id = 'r1'")
      ).rows[0]?.r;
      await expect(
        db.$client.execute({
          sql: "UPDATE OR REPLACE source_result SET rowid = ?, status = 'returned', received_at = 2 WHERE result_id = 'r2'",
          args: [Number(r1)],
        }),
      ).rejects.toThrow(/write-once from pending/);
      const rows = (
        await db.$client.execute("SELECT result_id, status FROM source_result ORDER BY result_id")
      ).rows;
      expect(rows.map((r) => [r.result_id, r.status])).toEqual([
        ["r1", "returned"],
        ["r2", "pending"],
      ]);
    } finally {
      db.$client.close();
    }
  });
  it.each([
    ["query_request", "query_request rowids are positive"],
    ["source_result", "source_result rowids are positive"],
  ])(
    "an explicit non-positive rowid in %s is refused, so auto-assigned inserts keep working (#279 rr:N2)",
    async (table, message) => {
      const db = await queryDb();
      try {
        const insert =
          table === "query_request"
            ? db.$client.execute({
                sql: `INSERT INTO query_request (rowid, correlation_id, part_id, user_id, origin, query_type,
                type_values, plate_only, selected_source_ids, dropped_source_ids, config_hash,
                idempotency_key, submitted_at)
                VALUES (-1, 'c9', 0, 'u1', 'primary', 'vehicle', '{}', 0, '[]', '[]', 'h1', NULL, 1)`,
                args: [],
              })
            : db.$client.execute({
                sql: `INSERT INTO source_result (rowid, result_id, correlation_id, part_id, source_id,
                user_id, status, adapter_kind, created_at) VALUES (-1, 'r9', ?, 0, 's9', 'u1', 'pending', 'mock', 1)`,
                args: [CID],
              });
        await expect(insert).rejects.toThrow(new RegExp(message));
        await insertQueryRequest(db, 1, null);
        await insertPendingResult(db, "r2", 1);
      } finally {
        db.$client.close();
      }
    },
  );
  it("normal inserts with auto-assigned rowids are not refused (#279 C-I1)", async () => {
    const db = await queryDb();
    try {
      await insertQueryRequest(db, 1, null);
      await insertQueryRequest(db, 0, "idem-2", "01890a5d-ac96-774b-bcce-b302099a8058");
      await insertPendingResult(db, "r2", 1);
      const n = async (t: string) =>
        Number((await db.$client.execute(`SELECT count(*) AS n FROM ${t}`)).rows[0]?.n);
      expect(await n("query_request")).toBe(3);
      expect(await n("source_result")).toBe(2);
    } finally {
      db.$client.close();
    }
  });
  it("a source_result status outside the spec 5.5 enum is refused (#279 C-M1)", async () => {
    const db = await queryDb();
    try {
      await expect(
        db.$client.execute({
          sql: `INSERT INTO source_result (result_id, correlation_id, part_id, source_id, user_id,
            status, adapter_kind, created_at) VALUES ('r2', ?, 0, 's2', 'u1', 'bogus', 'mock', 1)`,
          args: [CID],
        }),
      ).rejects.toThrow(/CHECK constraint failed/);
      await expect(setStatus(db, "pending", "bogus")).rejects.toThrow(/CHECK constraint failed/);
    } finally {
      db.$client.close();
    }
  });
  it.each([["nested"], ["Primary"], [""]])(
    "a query_request origin of %j is refused; primary and alsoRun are stored (#311)",
    async (origin) => {
      const db = await queryDb();
      try {
        await expect(
          db.$client.execute({
            sql: `INSERT INTO query_request (correlation_id, part_id, user_id, origin, query_type,
              type_values, plate_only, selected_source_ids, dropped_source_ids, config_hash,
              idempotency_key, submitted_at)
              VALUES (?, 1, 'u1', ?, 'vehicle', '{}', 0, '[]', '[]', 'h1', NULL, 1)`,
            args: [CID, origin],
          }),
        ).rejects.toThrow(/query_request origin must be primary or alsoRun/);
        await insertQueryRequest(db, 1, null);
        const rows = (await db.$client.execute("SELECT origin FROM query_request ORDER BY part_id"))
          .rows;
        expect(rows.map((r) => r.origin)).toEqual(["primary", "alsoRun"]);
      } finally {
        db.$client.close();
      }
    },
  );
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
      ).rejects.toThrow(/query_request idempotency key exists/);
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
  it("pins each query trigger's statement to migrations 0004, 0005 and 0006", () => {
    const statements = [
      "0004_query_triggers.sql",
      "0005_query_no_replace.sql",
      "0006_query_origin.sql",
    ].flatMap((f) =>
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
      expect(err).toBeInstanceOf(TriggerMissingError);
      expect((err as TriggerMissingError).missing).toEqual([name]);
      expect((err as TriggerMissingError).tables).toEqual(["query_request", "source_result"]);
      expect((err as TriggerMissingError).message).toBe(
        `query_request, source_result triggers missing: ${name}`,
      );
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
      expect(err).toBeInstanceOf(TriggerMissingError);
      expect((err as TriggerMissingError).missing).toEqual([]);
      expect((err as TriggerMissingError).altered).toEqual(["source_result_no_delete"]);
    } finally {
      db.$client.close();
    }
  });
  it("dropping source_result_write_once makes buildDeps throw TriggerMissingError", async () => {
    const env = testEnv();
    const db = await migratedEnvDb(env);
    try {
      await db.$client.execute("DROP TRIGGER source_result_write_once");
    } finally {
      db.$client.close();
    }
    const err = await buildDeps({ env, secrets: TEST_SECRETS }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TriggerMissingError);
    expect((err as TriggerMissingError).missing).toEqual(["source_result_write_once"]);
  });
});
