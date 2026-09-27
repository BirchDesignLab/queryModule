import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { DatabaseOpenError, openDatabase } from "../../src/db/client";
import {
  AUDIT_TRIGGER_SQL,
  AUDIT_TRIGGERS,
  AuditTriggerMissingError,
  checkAuditTriggers,
  runMigrations,
} from "../../src/db/migrate";
import { TEST_DB_KEY, tempDbFile } from "../helpers/db";

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
    const db = await migratedDb();
    try {
      await db.$client.execute("PRAGMA writable_schema = ON");
      await db.$client.execute(
        "UPDATE sqlite_master SET sql = 'CREATE TRIGGER audit_event_no_delete BEFORE DELETE ON audit_event BEGIN SELECT 1; END' WHERE type = 'trigger' AND name = 'audit_event_no_delete'",
      );
      await db.$client.execute("PRAGMA writable_schema = OFF");
      const err = await checkAuditTriggers(db).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AuditTriggerMissingError);
      expect((err as AuditTriggerMissingError).altered).toEqual(["audit_event_no_delete"]);
    } finally {
      db.$client.close();
    }
  });
});
