import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { systemClock } from "../src/clock";
import { runMigrations } from "../src/db/migrate";
import { keyCanary } from "../src/db/schema";
import {
  CANARY_GUARD_TABLES,
  checkKeyCanaries,
  KeyCanaryError,
  sealCanary,
} from "../src/keys/canary";
import { openTempDatabase, tempDbFile } from "./helpers/db";

const keys = { credentialKey: Buffer.alloc(32, 2), dataKey: Buffer.alloc(32, 3) };
async function fresh() {
  const db = await openTempDatabase();
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
  // A2 review C-M4: a second process on the same file creates the canary between this
  // process's read and its create. The create must not overwrite it; this process then
  // verifies its own key against the stored canary and fails closed.
  it("never overwrites a canary another process created after the read", async () => {
    const file = tempDbFile();
    const a = await openTempDatabase({ file });
    await runMigrations(a, resolve(import.meta.dirname, "../drizzle"));
    const b = await openTempDatabase({ file });
    const other = { credentialKey: Buffer.alloc(32, 7), dataKey: Buffer.alloc(32, 8) };
    const transaction = a.transaction.bind(a);
    let raced = false;
    a.transaction = (async (...args: Parameters<typeof a.transaction>) => {
      if (!raced) {
        raced = true;
        await checkKeyCanaries(b, other, systemClock);
      }
      return transaction(...args);
    }) as typeof a.transaction;
    const err = await checkKeyCanaries(a, keys, systemClock).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyCanaryError);
    expect((err as KeyCanaryError).keyName).toBe("credential");
    expect(await checkKeyCanaries(b, other, systemClock)).toEqual({
      credential: "verified",
      data: "verified",
    });
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
  // #277: canary.ts moved onto the shared AES-GCM helper. The pre-change inline code path
  // is copied here verbatim so a canary sealed by a P1 database still opens, and a canary
  // sealed by the new path still opens under the old one (same AAD, same columns).
  const LEGACY_PLAINTEXT = Buffer.from("querymodule-key-canary-v1", "utf8");
  const legacyAad = (n: string, v: number) => Buffer.from(`key_canary|${n}|${v}`, "utf8");
  function legacySeal(key: Buffer, keyName: "credential" | "data", keyVersion: number) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv).setAAD(legacyAad(keyName, keyVersion));
    const ciphertext = Buffer.concat([c.update(LEGACY_PLAINTEXT), c.final()]);
    return { ciphertext, iv, authTag: c.getAuthTag() };
  }
  it("verifies canaries sealed by the pre-helper code path", async () => {
    const db = await fresh();
    for (const [keyName, key] of [
      ["credential", keys.credentialKey],
      ["data", keys.dataKey],
    ] as const) {
      await db
        .insert(keyCanary)
        .values({ keyName, ...legacySeal(key, keyName, 1), keyVersion: 1, createdAt: 0 });
    }
    expect(await checkKeyCanaries(db, keys, systemClock)).toEqual({
      credential: "verified",
      data: "verified",
    });
    const wrong = { credentialKey: Buffer.alloc(32, 9), dataKey: keys.dataKey };
    await expect(checkKeyCanaries(db, wrong, systemClock)).rejects.toBeInstanceOf(KeyCanaryError);
  });
  it("seals canaries the pre-helper code path can open", () => {
    const s = sealCanary(keys.dataKey, "data", 1);
    const d = createDecipheriv("aes-256-gcm", keys.dataKey, s.iv).setAAD(legacyAad("data", 1));
    d.setAuthTag(s.authTag);
    expect(Buffer.concat([d.update(s.ciphertext), d.final()]).equals(LEGACY_PLAINTEXT)).toBe(true);
  });
});
