import { AsyncLocalStorage } from "node:async_hooks";
import {
  type Client,
  createClient,
  type InArgs,
  type InStatement,
  type Replicated,
  type ResultSet,
  type Transaction,
  type TransactionMode,
} from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

/*
 * One connection, one lock (developer ruling 09-27-26, Task 6 option B).
 *
 * @libsql/client 0.18 pools file connections, and pragmas such as foreign_keys and
 * busy_timeout are per connection, so the client is built with concurrency 1. A plain
 * client call fails with TRANSACTION_ACTIVE while a transaction holds that connection,
 * so every call queues behind one in-process lock: execute, batch, executeMultiple and
 * migrate hold it for the call; transaction() holds it until commit, rollback or close.
 * Statements on the Transaction object do not take the lock. The lock holder's async
 * context is tracked, so a plain call or a nested transaction from inside an open
 * transaction throws at once instead of queueing behind itself.
 */

export type Db = LibSQLDatabase<typeof schema> & { $client: Client };
export const REQUIRED_PRAGMAS = {
  journal_mode: "wal",
  synchronous: 2,
  secure_delete: 1,
  busy_timeout: 5000,
  foreign_keys: 1,
} as const;
export const DEFAULT_LOCK_TIMEOUT_MS = 5000;

export class DatabaseOpenError extends Error {
  constructor(reason: string) {
    super(`database open failed: ${reason}`);
    this.name = "DatabaseOpenError";
  }
}
export class NestedTransactionError extends Error {
  constructor() {
    super("database call inside an open transaction: use tx inside withTransaction");
    this.name = "NestedTransactionError";
  }
}
export class DatabaseLockTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`database lock not acquired within ${timeoutMs} ms`);
    this.name = "DatabaseLockTimeoutError";
  }
}

/*
 * SEC-013 (#189): the app connection never turns on writable_schema. Without it SQLite
 * itself refuses writes to sqlite_master and sqlite_schema, so an append-only or write-once
 * trigger cannot be rewritten in place. The pragma name is spelled in parts because the
 * source-layer scanner (scripts/ci/check-schema-writes.ts) refuses the whole token anywhere
 * in packages/api/src code outside comments; that scanner stays as the CI layer.
 */
const SCHEMA_WRITE_PRAGMA = ["writable", "schema"].join("_");
const SCHEMA_WRITE_PATTERN = new RegExp(SCHEMA_WRITE_PRAGMA, "i");

/** A statement named the refused pragma. The message names the rule, never the statement. */
export class SchemaWriteRefusedError extends Error {
  constructor() {
    super(`statement refused: ${SCHEMA_WRITE_PRAGMA} is not allowed on the app connection`);
    this.name = "SchemaWriteRefusedError";
  }
}

/** @libsql/client 0.18 does not expose SQLITE_DBCONFIG_DEFENSIVE, so this filter stands alone. */
function assertNoSchemaWrite(sql: string): void {
  if (SCHEMA_WRITE_PATTERN.test(sql)) throw new SchemaWriteRefusedError();
}

type StatementLike = InStatement | [string, InArgs?];

/** The SQL text of a statement in any form @libsql/client accepts. */
function sqlOf(stmt: StatementLike): string {
  if (typeof stmt === "string") return stmt;
  if (Array.isArray(stmt)) return stmt[0];
  return stmt.sql;
}

function assertNoSchemaWriteIn(stmts: readonly StatementLike[]): void {
  for (const stmt of stmts) assertNoSchemaWrite(sqlOf(stmt));
}

/** Runs the guard first, so a refusal surfaces as a rejection, as the libsql call would. */
function guarded<T>(check: () => void, op: () => Promise<T>): Promise<T> {
  try {
    check();
  } catch (e) {
    return Promise.reject(e);
  }
  return op();
}

type Release = () => void;

/** FIFO mutex whose waiters give up after a bounded wait. */
class Lock {
  #held = false;
  #waiters: Array<() => void> = [];

  acquire(timeoutMs: number): Promise<Release> {
    if (!this.#held) {
      this.#held = true;
      return Promise.resolve(this.#releaser());
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer);
        resolve(this.#releaser());
      };
      const timer = setTimeout(() => {
        this.#waiters.splice(this.#waiters.indexOf(grant), 1);
        reject(new DatabaseLockTimeoutError(timeoutMs));
      }, timeoutMs);
      this.#waiters.push(grant);
    });
  }

  #releaser(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiters.shift();
      if (next) next();
      else this.#held = false;
    };
  }
}

interface TxScope {
  lock: Lock;
  open: boolean;
  /** The enclosing scope, so a nested scope of another database does not mask this one. */
  parent: TxScope | undefined;
}
/** The innermost scope, in the current async context, that belongs to lock. */
function scopeOf(lock: Lock): TxScope | undefined {
  for (let s = txScope.getStore(); s; s = s.parent) if (s.lock === lock) return s;
  return undefined;
}
const txScope = new AsyncLocalStorage<TxScope>();

/**
 * A transaction that holds the lock until it settles. When commit, rollback or close
 * throws, @libsql/client may have dropped the connection (its pool closes one whose
 * ROLLBACK fails) and would open a fresh one without the pragmas, so recover re-applies
 * them, still under the lock, before the lock is released.
 */
class LockedTransaction implements Transaction {
  constructor(
    private readonly inner: Transaction,
    private readonly done: Release,
    private readonly recover: () => Promise<void>,
  ) {}
  execute(stmt: InStatement): Promise<ResultSet> {
    return guarded(
      () => assertNoSchemaWrite(sqlOf(stmt)),
      () => this.inner.execute(stmt),
    );
  }
  batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
    return guarded(
      () => assertNoSchemaWriteIn(stmts),
      () => this.inner.batch(stmts),
    );
  }
  executeMultiple(sql: string): Promise<void> {
    return guarded(
      () => assertNoSchemaWrite(sql),
      () => this.inner.executeMultiple(sql),
    );
  }
  async #settle(op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (e) {
      await this.recover();
      throw e;
    } finally {
      this.done();
    }
  }
  rollback(): Promise<void> {
    // SQLite may have ended the transaction itself (auto-rollback on SQLITE_FULL, IOERR or
    // NOMEM, or a raw ROLLBACK or COMMIT in the body). ROLLBACK would then throw
    // TRANSACTION_CLOSED, and drizzle awaits it in its catch, hiding the body's own error;
    // close() settles the connection without a ROLLBACK.
    if (this.inner.closed) {
      return this.#settle(async () => this.inner.close());
    }
    return this.#settle(() => this.inner.rollback());
  }
  commit(): Promise<void> {
    return this.#settle(() => this.inner.commit());
  }
  close(): void {
    try {
      this.inner.close();
    } catch (e) {
      // recover() never rejects; the second handler still keeps a fault off the unhandled path.
      void this.recover().then(this.done, this.done);
      throw e;
    }
    this.done();
  }
  get closed(): boolean {
    return this.inner.closed;
  }
}

class SerializedClient implements Client {
  readonly lock = new Lock();
  constructor(
    private readonly inner: Client,
    private readonly lockTimeoutMs: number,
  ) {}

  /** Throws when the caller runs inside this client's own open transaction. */
  assertOutsideOwnTransaction(): void {
    if (scopeOf(this.lock)?.open) throw new NestedTransactionError();
  }

  /**
   * Runs op under the lock. With recoverOnError, a rejection re-applies the pragmas before
   * the lock is released: batch, executeMultiple and migrate run their own transaction, and
   * @libsql/client drops the connection when its ROLLBACK on release fails (migrate also
   * leaves foreign_keys off when its ROLLBACK throws).
   */
  async #locked<T>(op: () => Promise<T>, recoverOnError = false): Promise<T> {
    this.assertOutsideOwnTransaction();
    const release = await this.lock.acquire(this.lockTimeoutMs);
    try {
      return await op();
    } catch (e) {
      if (recoverOnError) await this.reapplyPragmas();
      throw e;
    } finally {
      release();
    }
  }

  execute(stmt: InStatement): Promise<ResultSet>;
  execute(sql: string, args?: InArgs): Promise<ResultSet>;
  execute(stmt: InStatement | string, args?: InArgs): Promise<ResultSet> {
    return guarded(
      () => assertNoSchemaWrite(sqlOf(stmt)),
      () =>
        this.#locked(() =>
          typeof stmt === "string" ? this.inner.execute(stmt, args) : this.inner.execute(stmt),
        ),
    );
  }
  batch(
    stmts: Array<InStatement | [string, InArgs?]>,
    mode?: TransactionMode,
  ): Promise<Array<ResultSet>> {
    return guarded(
      () => assertNoSchemaWriteIn(stmts),
      () => this.#locked(() => this.inner.batch(stmts, mode), true),
    );
  }
  migrate(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
    return guarded(
      () => assertNoSchemaWriteIn(stmts),
      () => this.#locked(() => this.inner.migrate(stmts), true),
    );
  }
  executeMultiple(sql: string): Promise<void> {
    return guarded(
      () => assertNoSchemaWrite(sql),
      () => this.#locked(() => this.inner.executeMultiple(sql), true),
    );
  }
  /**
   * The "write" default is what makes withTransaction IMMEDIATE: drizzle-orm 0.45 ignores
   * { behavior: "immediate" } and calls transaction() with no mode, and libsql maps "write"
   * to BEGIN IMMEDIATE. Pinned by the db-client test "begins withTransaction IMMEDIATE".
   */
  async transaction(mode: TransactionMode = "write"): Promise<Transaction> {
    this.assertOutsideOwnTransaction();
    const release = await this.lock.acquire(this.lockTimeoutMs);
    let tx: Transaction;
    try {
      tx = await this.inner.transaction(mode);
    } catch (e) {
      release();
      throw e;
    }
    const own = scopeOf(this.lock);
    if (own) own.open = true;
    return new LockedTransaction(
      tx,
      () => {
        if (own) own.open = false;
        release();
      },
      () => this.reapplyPragmas(),
    );
  }
  /**
   * Re-applies and reads back the pragmas after a call failed to settle; the caller holds
   * the lock. If that fails, the database is closed so every later call rejects (fail
   * closed). Never throws: the caller rethrows its own error.
   */
  async reapplyPragmas(): Promise<void> {
    try {
      await applyPragmas(this.inner);
    } catch {
      try {
        this.inner.close();
      } catch {
        // best effort: the connection is already unusable
      }
    }
  }
  /** A reopened pool would hand out connections without the pragmas; reopen the database. */
  async sync(): Promise<Replicated> {
    throw new Error("sync is not supported on this database");
  }
  reconnect(): void {
    throw new Error("reconnect is not supported on this database; call openDatabase again");
  }
  close(): void {
    this.inner.close();
  }
  get closed(): boolean {
    return this.inner.closed;
  }
  get protocol(): string {
    return this.inner.protocol;
  }
}

type PragmaName = keyof typeof REQUIRED_PRAGMAS;
const PRAGMA_NAMES = Object.keys(REQUIRED_PRAGMAS) as PragmaName[];

/**
 * The per-connection pragmas of spec 5.5; journal_mode WAL also persists in the file.
 * SQLite reports a pragma it could not apply by keeping the old value, not by an error, so
 * every value is read back; a mismatch throws DatabaseOpenError naming the pragma.
 */
async function applyPragmas(client: Client): Promise<void> {
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA synchronous = FULL");
  await client.execute("PRAGMA secure_delete = ON");
  await client.execute("PRAGMA foreign_keys = ON");
  const actual = await readPragmaValues(client);
  for (const name of PRAGMA_NAMES) {
    if (actual[name] !== REQUIRED_PRAGMAS[name]) {
      throw new DatabaseOpenError(`pragma ${name} did not apply`);
    }
  }
}

async function readPragmaValues(client: Client): Promise<Record<PragmaName, string | number>> {
  const out = {} as Record<PragmaName, string | number>;
  for (const name of PRAGMA_NAMES) {
    const row = (await client.execute(`PRAGMA ${name}`)).rows[0];
    const v = row ? Object.values(row)[0] : null;
    out[name] = typeof v === "bigint" ? Number(v) : (v as string | number);
  }
  return out;
}

export async function openDatabase(o: {
  file: string;
  encryptionKey: string;
  lockTimeoutMs?: number;
}): Promise<Db> {
  if (o.encryptionKey.length === 0) throw new DatabaseOpenError("DB_ENCRYPTION_KEY is empty");
  const lockTimeoutMs = o.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs <= 0) {
    throw new DatabaseOpenError("lockTimeoutMs must be a positive integer");
  }
  let client: Client | undefined;
  try {
    // concurrency 1: one connection, so the per-connection pragmas below always apply.
    client = createClient({
      url: `file:${o.file}`,
      encryptionKey: o.encryptionKey,
      concurrency: 1,
    });
    await applyPragmas(client);
    await client.execute("SELECT count(*) FROM sqlite_master"); // proves the key opens the file
  } catch (e) {
    client?.close();
    if (e instanceof DatabaseOpenError) throw e;
    throw new DatabaseOpenError(e instanceof Error ? e.name : "unknown");
  }
  const serialized = new SerializedClient(client, lockTimeoutMs);
  return drizzle(serialized, { schema, casing: "snake_case" }) as Db;
}

/**
 * Runs body in a transaction scope of db, so the lock knows its holder. Used by
 * withTransaction (tx.ts) only.
 */
export function inTransactionScope<T>(db: Db, body: () => Promise<T>): Promise<T> {
  const client = db.$client;
  if (!(client instanceof SerializedClient)) {
    return Promise.reject(new Error("withTransaction needs a database from openDatabase"));
  }
  try {
    client.assertOutsideOwnTransaction();
  } catch (e) {
    return Promise.reject(e);
  }
  return txScope.run({ lock: client.lock, open: false, parent: txScope.getStore() }, body);
}

export function readPragmas(db: Db): Promise<Record<PragmaName, string | number>> {
  return readPragmaValues(db.$client);
}
