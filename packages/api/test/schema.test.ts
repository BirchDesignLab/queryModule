import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { type Db, openDatabase } from "../src/db/client";
import { TEST_DB_KEY, tempDbFile } from "./helpers/db";

async function openMigrated(): Promise<Db> {
  const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
  try {
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../drizzle") });
  } catch (e) {
    db.$client.close();
    throw e;
  }
  return db;
}

/** A fresh migrated database for a test that writes; closed when the test finishes. */
async function migrated(): Promise<Db> {
  const db = await openMigrated();
  onTestFinished(() => db.$client.close());
  return db;
}

/** One migrated database shared by a describe whose tests only read the schema (#311). */
function sharedMigrated(): () => Db {
  let db: Db | undefined;
  beforeAll(async () => {
    db = await openMigrated();
  });
  afterAll(() => db?.$client.close());
  return () => {
    if (!db) throw new Error("shared database not open");
    return db;
  };
}
const insert =
  "INSERT INTO audit_event (type, at, actor_user_id, actor_role, identity_source, details) VALUES ('logout', 1, 'u', 'user', 'local', '{}')";

describe("audit_event is append-only (spec 5.5, 9.2)", () => {
  it("creates every P1 table", async () => {
    const db = await migrated();
    const rows = (
      await db.$client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    ).rows.map((r) => r.name);
    expect(rows).toEqual(
      expect.arrayContaining([
        "account",
        "audit_event",
        "key_canary",
        "rate_limit",
        "session",
        "user",
        "user_preference",
        "verification",
      ]),
    );
  });
  it("aborts UPDATE and DELETE", async () => {
    const db = await migrated();
    await db.$client.execute(insert);
    await expect(db.$client.execute("UPDATE audit_event SET type='x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(db.$client.execute("DELETE FROM audit_event")).rejects.toThrow(/append-only/);
  });
  it("aborts INSERT OR REPLACE and REPLACE INTO on an existing id", async () => {
    const db = await migrated();
    await db.$client.execute(insert);
    const replace = (verb: string) =>
      `${verb} INTO audit_event (id, type, at, actor_user_id, actor_role, identity_source, details) VALUES (1, 'loginFailed', 2, 'forged', 'user', 'local', '{}')`;
    await expect(db.$client.execute(replace("INSERT OR REPLACE"))).rejects.toThrow(/append-only/);
    await expect(db.$client.execute(replace("REPLACE"))).rejects.toThrow(/append-only/);
    const row = (
      await db.$client.execute("SELECT type, actor_user_id FROM audit_event WHERE id = 1")
    ).rows[0];
    expect({ type: row?.type, actor: row?.actor_user_id }).toEqual({ type: "logout", actor: "u" });
  });
  it("orders ids as integers", async () => {
    const db = await migrated();
    await db.$client.execute(insert);
    await db.$client.execute(insert);
    const ids = (await db.$client.execute("SELECT id FROM audit_event ORDER BY id")).rows.map((r) =>
      Number(r.id),
    );
    expect(ids).toEqual([1, 2]);
  });
});

describe("user_preference columns (spec 5.5)", () => {
  it("gives user_preference nullable default_view and locale columns", async () => {
    const db = await migrated();
    const cols = (await db.$client.execute("PRAGMA table_info(user_preference)")).rows.map((r) => ({
      name: r.name,
      notnull: Number(r.notnull),
    }));
    expect(cols).toEqual(
      expect.arrayContaining([
        { name: "default_view", notnull: 0 },
        { name: "locale", notnull: 0 },
      ]),
    );
  });
});

describe("query tables (spec 5.5, SEC-013)", () => {
  const shared = sharedMigrated();
  const columns = async (table: string) =>
    (await shared().$client.execute(`PRAGMA table_info(${table})`)).rows.map((r) => r.name);
  const indexes = async (table: string) =>
    (await shared().$client.execute(`PRAGMA index_list(${table})`)).rows
      .filter((r) => !String(r.name).startsWith("sqlite_autoindex_"))
      .map((r) => ({ name: r.name, unique: Number(r.unique), partial: Number(r.partial) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  it("query_request has exactly the spec 5.5 columns", async () => {
    expect(await columns("query_request")).toEqual([
      "correlation_id",
      "part_id",
      "user_id",
      "parent_part_id",
      "origin",
      "query_type",
      "type_values",
      "values_ciphertext",
      "values_iv",
      "values_tag",
      "plate_only",
      "selected_source_ids",
      "dropped_source_ids",
      "skipped_reason",
      "config_hash",
      "idempotency_key",
      "submitted_at",
    ]);
  });
  it("source_result has exactly the spec 5.5 columns", async () => {
    expect(await columns("source_result")).toEqual([
      "result_id",
      "correlation_id",
      "part_id",
      "source_id",
      "user_id",
      "status",
      "credential_user_id",
      "delegation_id",
      "adapter_kind",
      "payload_ciphertext",
      "payload_iv",
      "payload_tag",
      "error_code",
      "created_at",
      "received_at",
      "timed_out_at",
    ]);
  });
  it("request_key has exactly the spec 5.5 columns", async () => {
    expect(await columns("request_key")).toEqual([
      "correlation_id",
      "scope",
      "wrapped_dek",
      "iv",
      "auth_tag",
      "key_version",
      "created_at",
    ]);
  });
  it("query_request indexes: the idempotency index is unique and partial", async () => {
    expect(await indexes("query_request")).toEqual([
      { name: "query_request_idempotency_idx", unique: 1, partial: 1 },
      { name: "query_request_user_submitted_idx", unique: 0, partial: 0 },
    ]);
  });
  it("source_result indexes", async () => {
    expect(await indexes("source_result")).toEqual([
      { name: "source_result_credential_created_idx", unique: 0, partial: 0 },
      { name: "source_result_part_source_idx", unique: 1, partial: 0 },
      { name: "source_result_status_idx", unique: 0, partial: 0 },
      { name: "source_result_user_created_idx", unique: 0, partial: 0 },
    ]);
  });
  it("request_key.scope accepts only the scopes lost-key.ts shreds (Task 12 carry)", async () => {
    const db = await migrated();
    const put = (scope: string) =>
      db.$client.execute({
        sql: "INSERT INTO request_key VALUES ('c1', ?, x'01', x'02', x'03', 1, 1)",
        args: [scope],
      });
    await put("values");
    await put("payload");
    await expect(put("other")).rejects.toThrow(/CHECK constraint failed/);
  });
});
