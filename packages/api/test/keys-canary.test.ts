import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { systemClock } from "../src/clock";
import { openDatabase } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { checkKeyCanaries } from "../src/keys/canary";
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
});
