import { resolve } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { describe, expect, it, onTestFinished } from "vitest";
import { openDatabase } from "../src/db/client";
import { TEST_DB_KEY, tempDbFile } from "./helpers/db";

async function migrated() {
  const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
  onTestFinished(() => db.$client.close());
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../drizzle") });
  return db;
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
