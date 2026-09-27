import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { systemClock } from "../src/clock";
import { openDatabase } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { CANARY_GUARD_TABLES, checkKeyCanaries, KeyCanaryError } from "../src/keys/canary";
import { TEST_DB_KEY, tempDbFile } from "./helpers/db";

const keys = { credentialKey: Buffer.alloc(32, 2), dataKey: Buffer.alloc(32, 3) };
async function fresh() {
  const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
  await runMigrations(db, resolve(import.meta.dirname, "../drizzle"));
  return db;
}

describe("SEC-006 key canaries", () => {
  it("creates on first boot, verifies after", async () => {
    const db = await fresh();
    expect(await checkKeyCanaries(db, keys, systemClock)).toEqual({
      credential: "created",
      data: "created",
    });
    expect(await checkKeyCanaries(db, keys, systemClock)).toEqual({
      credential: "verified",
      data: "verified",
    });
  });
  it("stores ciphertext, not the plaintext", async () => {
    const db = await fresh();
    await checkKeyCanaries(db, keys, systemClock);
    const row = (
      await db.$client.execute("SELECT ciphertext FROM key_canary WHERE key_name='credential'")
    ).rows[0];
    expect(Buffer.from(row?.ciphertext as ArrayBuffer).toString("utf8")).not.toContain(
      "querymodule",
    );
  });
  it.each([
    ["credential", "state_credential"],
    ["data", "request_key"],
  ] as const)("refuses to recreate a lost %s canary while %s holds rows", async (name, table) => {
    expect(CANARY_GUARD_TABLES[name]).toBe(table);
    const db = await fresh();
    await checkKeyCanaries(db, keys, systemClock);
    await db.$client.execute(`CREATE TABLE ${table} (user_id TEXT)`);
    await db.$client.execute(`INSERT INTO ${table} (user_id) VALUES ('u1')`);
    await db.$client.execute({
      sql: "DELETE FROM key_canary WHERE key_name = ?",
      args: [name],
    });
    const err = await checkKeyCanaries(db, keys, systemClock).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyCanaryError);
    expect((err as KeyCanaryError).keyName).toBe(name);
    const left = await db.$client.execute({
      sql: "SELECT count(*) AS n FROM key_canary WHERE key_name = ?",
      args: [name],
    });
    expect(Number(left.rows[0]?.n)).toBe(0);
  });
  it("recreates a lost canary when its guard table exists but is empty", async () => {
    const db = await fresh();
    await checkKeyCanaries(db, keys, systemClock);
    await db.$client.execute("CREATE TABLE state_credential (user_id TEXT)");
    await db.$client.execute("DELETE FROM key_canary WHERE key_name = 'credential'");
    expect(await checkKeyCanaries(db, keys, systemClock)).toEqual({
      credential: "created",
      data: "verified",
    });
  });
});
