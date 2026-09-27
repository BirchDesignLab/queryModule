import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type Client, createClient, type ResultSet, type Transaction } from "@libsql/client";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { describe, expect, it, vi } from "vitest";
import {
  DatabaseLockTimeoutError,
  DatabaseOpenError,
  type Db,
  NestedTransactionError,
  openDatabase,
  REQUIRED_PRAGMAS,
  readPragmas,
} from "../src/db/client";
import { withTransaction } from "../src/db/tx";
import { TEST_DB_KEY, tempDbFile } from "./helpers/db";

const WRONG_KEY = "wrong-key-wrong-key-wrong-key-wrong";

async function count(db: Db, table = "t"): Promise<unknown> {
  return (await db.$client.execute(`SELECT count(*) AS n FROM ${table}`)).rows[0]?.n;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The key still applies: the wrong key fails closed, the right key reopens the data. */
async function expectKeyStillApplies(db: Db, file: string): Promise<void> {
  db.$client.close();
  await expect(openDatabase({ file, encryptionKey: WRONG_KEY })).rejects.toThrow(DatabaseOpenError);
  const again = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
  expect(await readPragmas(again)).toEqual(REQUIRED_PRAGMAS);
  again.$client.close();
}

/** The libsql client SerializedClient wraps (private at the type level only). */
function innerClient(db: Db): Client {
  return (db.$client as unknown as { inner: Client }).inner;
}

/** The PRAGMA assignments (not the read-backs) sent to the inner client since the spy started. */
function pragmaCalls(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => String(c[0])).filter((s) => /^PRAGMA \w+ = /.test(s));
}

/** Makes the inner client's read of one pragma report a value other than the one set. */
function misreportPragma(db: Db, name: string, value: string | number): void {
  const inner = innerClient(db);
  const real = inner.execute.bind(inner);
  vi.spyOn(inner, "execute").mockImplementation(((stmt: string) =>
    stmt === `PRAGMA ${name}`
      ? Promise.resolve({ rows: [{ [name]: value }] } as unknown as ResultSet)
      : real(stmt)) as Client["execute"]);
}

/** Makes every PRAGMA on the inner client fail, and its close() close and then throw. */
function breakPragmasAndClose(db: Db): void {
  const inner = innerClient(db);
  const real = inner.execute.bind(inner);
  vi.spyOn(inner, "execute").mockImplementation(((stmt: string) =>
    stmt.startsWith("PRAGMA")
      ? Promise.reject(new Error("pragma failed"))
      : real(stmt)) as Client["execute"]);
  const realClose = inner.close.bind(inner);
  vi.spyOn(inner, "close").mockImplementation(() => {
    realClose();
    throw new Error("close failed");
  });
}

const REAPPLIED = [
  "PRAGMA busy_timeout = 5000",
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = FULL",
  "PRAGMA secure_delete = ON",
  "PRAGMA foreign_keys = ON",
];

async function withParentChild(file: string): Promise<Db> {
  const db = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
  await db.$client.executeMultiple(
    "CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (p INTEGER REFERENCES p(id));",
  );
  return db;
}

/** A body whose COMMIT fails: a deferred foreign key violation. */
async function deferredFkViolation(tx: Parameters<Parameters<typeof withTransaction>[1]>[0]) {
  await tx.run(sql`PRAGMA defer_foreign_keys = ON`);
  await tx.run(sql`INSERT INTO c VALUES (1)`);
}

describe("SEC-006 encrypted database", () => {
  it("sets every pragma", async () => {
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    expect(await readPragmas(db)).toEqual({
      journal_mode: "wal",
      synchronous: 2,
      secure_delete: 1,
      busy_timeout: 5000,
      foreign_keys: 1,
    });
  });

  it("keeps pragmas after a transaction", async () => {
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    await withTransaction(db, async (tx) => {
      await tx.run(sql`CREATE TABLE t (x INTEGER)`);
    });
    expect(await readPragmas(db)).toEqual(REQUIRED_PRAGMAS);
  });

  it("rolls back on throw", async () => {
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    await db.$client.execute("CREATE TABLE t (x INTEGER)");
    await expect(
      withTransaction(db, async (tx) => {
        await tx.run(sql`INSERT INTO t VALUES (1)`);
        throw new Error("no");
      }),
    ).rejects.toThrow("no");
    expect(await count(db)).toBe(0);
  });

  it("commits and returns the body's result", async () => {
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    await db.$client.execute("CREATE TABLE t (x INTEGER)");
    const out = await withTransaction(db, async (tx) => {
      await tx.run(sql`INSERT INTO t VALUES (1)`);
      return "done";
    });
    expect(out).toBe("done");
    expect(await count(db)).toBe(1);
  });

  it("serialises concurrent transactions", async () => {
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    await db.$client.execute("CREATE TABLE t (x INTEGER)");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withTransaction(db, async (tx) => {
          await tx.run(sql`INSERT INTO t VALUES (${i})`);
        }),
      ),
    );
    expect(await count(db)).toBe(20);
  });

  it("keeps foreign_keys and busy_timeout across 20 parallel statements", async () => {
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    await db.$client.executeMultiple(
      "CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (p INTEGER NOT NULL REFERENCES p(id));",
    );
    const fk = await Promise.all(
      Array.from({ length: 20 }, () => db.$client.execute("PRAGMA foreign_keys")),
    );
    expect(fk.map((r) => Number(r.rows[0]?.foreign_keys))).toEqual(Array(20).fill(1));
    const bt = await Promise.all(
      Array.from({ length: 20 }, () => db.$client.execute("PRAGMA busy_timeout")),
    );
    expect(bt.map((r) => Number(Object.values(r.rows[0] ?? {})[0]))).toEqual(Array(20).fill(5000));
    const inserts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        db.$client.execute({ sql: "INSERT INTO c VALUES (?)", args: [i + 1] }),
      ),
    );
    expect(inserts.every((r) => r.status === "rejected")).toBe(true);
    expect(await count(db, "c")).toBe(0);
  });

  it("makes a plain read from another async context wait for an open transaction", async () => {
    const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
    await db.$client.execute("CREATE TABLE t (x INTEGER)");
    const inside = deferred();
    const gate = deferred();
    const tx = withTransaction(db, async (t) => {
      await t.run(sql`INSERT INTO t VALUES (1)`);
      inside.resolve();
      await gate.promise;
    });
    await inside.promise;
    let settled = false;
    const read = count(db).then((n) => {
      settled = true;
      return n;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);
    gate.resolve();
    await tx;
    expect(await read).toBe(1);
  });

  describe("re-entrancy guard", () => {
    it("rejects a plain db call inside the transaction's own context at once", async () => {
      const db = await openDatabase({
        file: tempDbFile(),
        encryptionKey: TEST_DB_KEY,
        lockTimeoutMs: 60_000,
      });
      await db.$client.execute("CREATE TABLE t (x INTEGER)");
      await withTransaction(db, async (tx) => {
        await tx.run(sql`INSERT INTO t VALUES (1)`);
        // drizzle wraps driver errors in DrizzleQueryError; the guard's error is the cause.
        await expect(db.run(sql`SELECT 1`)).rejects.toMatchObject({
          cause: expect.any(NestedTransactionError),
        });
        await expect(db.$client.execute("SELECT 1")).rejects.toThrow(
          "use tx inside withTransaction",
        );
        await expect(db.$client.batch(["SELECT 1"])).rejects.toThrow(
          "use tx inside withTransaction",
        );
        await tx.run(sql`INSERT INTO t VALUES (2)`);
      });
      expect(await count(db)).toBe(2);
    });

    it("rejects a nested withTransaction at once", async () => {
      const db = await openDatabase({
        file: tempDbFile(),
        encryptionKey: TEST_DB_KEY,
        lockTimeoutMs: 60_000,
      });
      await db.$client.execute("CREATE TABLE t (x INTEGER)");
      await expect(
        withTransaction(db, async (tx) => {
          await tx.run(sql`INSERT INTO t VALUES (1)`);
          await withTransaction(db, async (inner) => {
            await inner.run(sql`INSERT INTO t VALUES (2)`);
          });
        }),
      ).rejects.toThrow("use tx inside withTransaction");
      expect(await count(db)).toBe(0);
    });

    it("lets the context use the database normally once the transaction closed", async () => {
      const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      await db.$client.execute("CREATE TABLE t (x INTEGER)");
      let later: Promise<unknown> = Promise.resolve();
      const gate = deferred();
      await withTransaction(db, async (tx) => {
        await tx.run(sql`INSERT INTO t VALUES (1)`);
        later = gate.promise.then(() => count(db));
      });
      gate.resolve();
      expect(await later).toBe(1);
    });

    it("does not block a different database from inside a transaction", async () => {
      const a = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      const b = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      const n = await withTransaction(a, async () => {
        return (await b.$client.execute("SELECT 7 AS n")).rows[0]?.n;
      });
      expect(n).toBe(7);
    });

    it("rejects withTransaction on a database openDatabase did not build", async () => {
      const raw = drizzle(createClient({ url: `file:${tempDbFile()}` })) as unknown as Db;
      await expect(withTransaction(raw, async () => 1)).rejects.toThrow(/openDatabase/);
      raw.$client.close();
    });
  });

  describe("wave review fixes", () => {
    it("surfaces the body's own error when SQLite already ended the transaction (C-M2)", async () => {
      const db = await openDatabase({
        file: tempDbFile(),
        encryptionKey: TEST_DB_KEY,
        lockTimeoutMs: 1000,
      });
      await db.$client.execute("CREATE TABLE t (x INTEGER)");
      await expect(
        withTransaction(db, async (tx) => {
          await tx.run(sql`INSERT INTO t VALUES (1)`);
          await tx.run(sql`ROLLBACK`); // what SQLite does itself on SQLITE_FULL, IOERR or NOMEM
          throw new Error("disk full");
        }),
      ).rejects.toThrow("disk full");
      expect(await count(db)).toBe(0);
      expect(await readPragmas(db)).toEqual(REQUIRED_PRAGMAS);
    });

    it("begins withTransaction IMMEDIATE: a second connection cannot take the write lock (C-M3)", async () => {
      const file = tempDbFile();
      const db = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
      await db.$client.execute("CREATE TABLE t (x INTEGER)");
      const other = createClient({ url: `file:${file}`, encryptionKey: TEST_DB_KEY });
      try {
        await withTransaction(db, async () => {
          // the body has run no statement: only BEGIN IMMEDIATE can hold the write lock here
          await expect(other.transaction("write")).rejects.toThrow(/SQLITE_BUSY|locked/);
        });
        const t = await other.transaction("write"); // free again once the body settled
        await t.rollback();
      } finally {
        other.close();
      }
    });

    it("rejects a plain call on the outer database inside a nested database's transaction (C-M4)", async () => {
      const a = await openDatabase({
        file: tempDbFile(),
        encryptionKey: TEST_DB_KEY,
        lockTimeoutMs: 1000,
      });
      const b = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      await withTransaction(a, async () => {
        await withTransaction(b, async () => {
          await expect(a.$client.execute("SELECT 1")).rejects.toThrow(NestedTransactionError);
          await expect(withTransaction(a, async () => 1)).rejects.toThrow(NestedTransactionError);
          await expect(b.$client.execute("SELECT 1")).rejects.toThrow(NestedTransactionError);
        });
      });
    });
  });

  describe("bounded lock wait", () => {
    it("throws instead of hanging behind a transaction that never closes", async () => {
      const db = await openDatabase({
        file: tempDbFile(),
        encryptionKey: TEST_DB_KEY,
        lockTimeoutMs: 100,
      });
      const opened = deferred();
      void withTransaction(db, async () => {
        opened.resolve();
        await new Promise(() => {});
      });
      await opened.promise;
      const started = Date.now();
      await expect(db.$client.execute("SELECT 1")).rejects.toThrow(DatabaseLockTimeoutError);
      expect(Date.now() - started).toBeGreaterThanOrEqual(90);
      await expect(withTransaction(db, async () => 1)).rejects.toThrow(/100 ms/);
      db.$client.close();
    });

    it("defaults to about 5 seconds", async () => {
      const { DEFAULT_LOCK_TIMEOUT_MS } = await import("../src/db/client");
      expect(DEFAULT_LOCK_TIMEOUT_MS).toBe(5000);
    });

    it("rejects a lock timeout that is not a positive integer", async () => {
      await expect(
        openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY, lockTimeoutMs: 0 }),
      ).rejects.toThrow(DatabaseOpenError);
    });
  });

  describe("pragma and key durability", () => {
    it("hold after a failed statement", async () => {
      const file = tempDbFile();
      const db = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
      await expect(db.$client.execute("INSERT INTO missing VALUES (1)")).rejects.toThrow();
      await expect(db.$client.batch(["CREATE TABLE b (x)", "NOT SQL"])).rejects.toThrow();
      expect(await readPragmas(db)).toEqual(REQUIRED_PRAGMAS);
      await expectKeyStillApplies(db, file);
    });

    it("hold after a rollback", async () => {
      const file = tempDbFile();
      const db = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
      await db.$client.execute("CREATE TABLE t (x INTEGER)");
      await expect(
        withTransaction(db, async (tx) => {
          await tx.run(sql`INSERT INTO t VALUES (1)`);
          await tx.run(sql`NOT SQL`);
        }),
      ).rejects.toThrow();
      expect(await count(db)).toBe(0);
      expect(await readPragmas(db)).toEqual(REQUIRED_PRAGMAS);
      await expectKeyStillApplies(db, file);
    });
  });

  describe("pragma re-apply when a transaction fails to settle", () => {
    it("re-applies the pragmas when COMMIT fails, and the key still applies", async () => {
      const file = tempDbFile();
      const db = await withParentChild(file);
      const exec = vi.spyOn(innerClient(db), "execute");
      await expect(withTransaction(db, deferredFkViolation)).rejects.toThrow(/FOREIGN KEY/);
      expect(pragmaCalls(exec)).toEqual(REAPPLIED);
      exec.mockRestore();
      expect(await count(db, "c")).toBe(0);
      expect(await readPragmas(db)).toEqual(REQUIRED_PRAGMAS);
      await expectKeyStillApplies(db, file);
    });

    it("closes the database when the re-apply fails, and rethrows the original error", async () => {
      const db = await withParentChild(tempDbFile());
      const inner = innerClient(db);
      const real = inner.execute.bind(inner);
      vi.spyOn(inner, "execute").mockImplementation(((stmt: string) =>
        stmt.startsWith("PRAGMA")
          ? Promise.reject(new Error("pragma failed"))
          : real(stmt)) as Client["execute"]);
      await expect(withTransaction(db, deferredFkViolation)).rejects.toThrow(/FOREIGN KEY/);
      expect(db.$client.closed).toBe(true);
      await expect(db.$client.execute("SELECT 1")).rejects.toThrow(/closed/);
    });

    it("re-applies the pragmas when a raw transaction's close throws", async () => {
      const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      const exec = vi.spyOn(innerClient(db), "execute");
      const t = await db.$client.transaction();
      const innerTx = (t as unknown as { inner: Transaction }).inner;
      const realClose = innerTx.close.bind(innerTx);
      vi.spyOn(innerTx, "close").mockImplementation(() => {
        realClose();
        throw new Error("close failed");
      });
      expect(() => t.close()).toThrow("close failed");
      expect(await readPragmas(db)).toEqual(REQUIRED_PRAGMAS);
      expect(pragmaCalls(exec).slice(0, REAPPLIED.length)).toEqual(REAPPLIED);
    });
  });

  describe("pragma re-apply when a plain batch, executeMultiple or migrate fails", () => {
    it("re-applies the pragmas after a failing batch", async () => {
      const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      const exec = vi.spyOn(innerClient(db), "execute");
      await expect(db.$client.batch(["CREATE TABLE b (x)", "NOT SQL"])).rejects.toThrow();
      expect(pragmaCalls(exec)).toEqual(REAPPLIED);
      exec.mockRestore();
      expect(await readPragmas(db)).toEqual(REQUIRED_PRAGMAS);
    });

    it("re-applies the pragmas after a failing executeMultiple and a failing migrate", async () => {
      const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      const exec = vi.spyOn(innerClient(db), "execute");
      await expect(db.$client.executeMultiple("CREATE TABLE m (x); NOT SQL;")).rejects.toThrow();
      expect(pragmaCalls(exec)).toEqual(REAPPLIED);
      exec.mockClear();
      await expect(db.$client.migrate([{ sql: "NOT SQL", args: [] }])).rejects.toThrow();
      expect(pragmaCalls(exec)).toEqual(REAPPLIED);
      exec.mockRestore();
      expect(await readPragmas(db)).toEqual(REQUIRED_PRAGMAS);
    });

    it("does not re-apply after a successful batch", async () => {
      const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      const exec = vi.spyOn(innerClient(db), "execute");
      await db.$client.batch(["CREATE TABLE b (x)"]);
      expect(pragmaCalls(exec)).toEqual([]);
    });

    it("closes the database when the re-apply after a failing batch fails", async () => {
      const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      const inner = innerClient(db);
      const real = inner.execute.bind(inner);
      vi.spyOn(inner, "execute").mockImplementation(((stmt: string) =>
        stmt.startsWith("PRAGMA")
          ? Promise.reject(new Error("pragma failed"))
          : real(stmt)) as Client["execute"]);
      await expect(db.$client.batch(["NOT SQL"])).rejects.toThrow(/NOT/);
      expect(db.$client.closed).toBe(true);
    });
  });

  describe("pragma read-back", () => {
    it("closes the database when a re-applied pragma reads back a different value", async () => {
      const db = await withParentChild(tempDbFile());
      misreportPragma(db, "foreign_keys", 0);
      await expect(withTransaction(db, deferredFkViolation)).rejects.toThrow(/FOREIGN KEY/);
      expect(db.$client.closed).toBe(true);
      await expect(db.$client.execute("SELECT 1")).rejects.toThrow(/closed/);
    });
  });

  describe("double fault: the re-apply fails and the fallback close throws", () => {
    it("still rejects with the transaction's own error and fails closed", async () => {
      const db = await withParentChild(tempDbFile());
      breakPragmasAndClose(db);
      await expect(withTransaction(db, deferredFkViolation)).rejects.toThrow(/FOREIGN KEY/);
      expect(db.$client.closed).toBe(true);
      await expect(db.$client.execute("SELECT 1")).rejects.toThrow(/closed/);
    });

    it("leaves no unhandled rejection when a raw transaction's close throws", async () => {
      const db = await openDatabase({
        file: tempDbFile(),
        encryptionKey: TEST_DB_KEY,
        lockTimeoutMs: 200,
      });
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const t = await db.$client.transaction();
        const innerTx = (t as unknown as { inner: Transaction }).inner;
        const realTxClose = innerTx.close.bind(innerTx);
        vi.spyOn(innerTx, "close").mockImplementation(() => {
          realTxClose();
          throw new Error("tx close failed");
        });
        breakPragmasAndClose(db);
        expect(() => t.close()).toThrow("tx close failed");
        await new Promise((r) => setTimeout(r, 20));
        expect(unhandled).toEqual([]);
        // the lock was released: the next call fails closed at once, not by lock timeout
        await expect(db.$client.execute("SELECT 1")).rejects.toThrow(/closed/);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });

  describe("serialised client surface", () => {
    it("runs batch, executeMultiple and migrate behind the lock", async () => {
      const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      expect(db.$client.protocol).toBe("file");
      expect(db.$client.closed).toBe(false);
      await db.$client.batch(["CREATE TABLE t (x INTEGER)", "INSERT INTO t VALUES (1)"], "write");
      await db.$client.migrate([{ sql: "INSERT INTO t VALUES (2)", args: [] }]);
      await db.$client.executeMultiple("INSERT INTO t VALUES (3); INSERT INTO t VALUES (4);");
      expect(await count(db)).toBe(4);
      expect(await readPragmas(db)).toEqual(REQUIRED_PRAGMAS);
      db.$client.close();
      expect(db.$client.closed).toBe(true);
      // a transaction that fails to begin gives the lock back: the next call fails fast
      await expect(db.$client.transaction()).rejects.toThrow(/closed/);
      await expect(db.$client.execute("SELECT 1")).rejects.toThrow(/closed/);
    });

    it("releases the lock when a raw transaction closes", async () => {
      const db = await openDatabase({
        file: tempDbFile(),
        encryptionKey: TEST_DB_KEY,
        lockTimeoutMs: 200,
      });
      const t = await db.$client.transaction("write");
      await t.batch(["CREATE TABLE t (x INTEGER)"]);
      await t.executeMultiple("INSERT INTO t VALUES (1);");
      expect(t.closed).toBe(false);
      t.close();
      t.close();
      expect(t.closed).toBe(true);
      await expect(count(db)).rejects.toThrow(/no such table/);
      const u = await db.$client.transaction();
      await u.execute("CREATE TABLE t (x INTEGER)");
      await u.commit();
      expect(await count(db)).toBe(0);
    });

    it("refuses sync and reconnect, which would drop the connection's pragmas", async () => {
      const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
      await expect(db.$client.sync()).rejects.toThrow(/not supported/);
      expect(() => db.$client.reconnect()).toThrow(/not supported/);
    });
  });

  it("fails to open without the key and with a wrong key", async () => {
    const file = tempDbFile();
    const db = await openDatabase({ file, encryptionKey: TEST_DB_KEY });
    await db.$client.execute("CREATE TABLE t (x INTEGER)");
    db.$client.close();
    await expect(openDatabase({ file, encryptionKey: "" })).rejects.toThrow(DatabaseOpenError);
    const err = await openDatabase({ file, encryptionKey: WRONG_KEY }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseOpenError);
    expect(String((err as Error).message)).not.toContain(WRONG_KEY);
    expect(String((err as Error).message)).not.toContain(TEST_DB_KEY);
  });

  it("opens a libsql transaction only inside src/db", () => {
    const root = join(import.meta.dirname, "../src");
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
      );
    for (const f of walk(root).filter((p) => p.endsWith(".ts"))) {
      if (relative(root, f).split(sep)[0] === "db") continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\.transaction\(/);
    }
  });
});
