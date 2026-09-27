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
}
const txScope = new AsyncLocalStorage<TxScope>();

class LockedTransaction implements Transaction {
  constructor(
    private readonly inner: Transaction,
    private readonly done: Release,
  ) {}
  execute(stmt: InStatement): Promise<ResultSet> {
    return this.inner.execute(stmt);
  }
  batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
    return this.inner.batch(stmts);
  }
  executeMultiple(sql: string): Promise<void> {
    return this.inner.executeMultiple(sql);
  }
  async rollback(): Promise<void> {
    try {
      await this.inner.rollback();
    } finally {
      this.done();
    }
  }
  async commit(): Promise<void> {
    try {
      await this.inner.commit();
    } finally {
      this.done();
    }
  }
  close(): void {
    try {
      this.inner.close();
    } finally {
      this.done();
    }
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
    const scope = txScope.getStore();
    if (scope?.lock === this.lock && scope.open) throw new NestedTransactionError();
  }

  async #locked<T>(op: () => Promise<T>): Promise<T> {
    this.assertOutsideOwnTransaction();
    const release = await this.lock.acquire(this.lockTimeoutMs);
    try {
      return await op();
    } finally {
      release();
    }
  }

  execute(stmt: InStatement): Promise<ResultSet>;
  execute(sql: string, args?: InArgs): Promise<ResultSet>;
  execute(stmt: InStatement | string, args?: InArgs): Promise<ResultSet> {
    return this.#locked(() =>
      typeof stmt === "string" ? this.inner.execute(stmt, args) : this.inner.execute(stmt),
    );
  }
  batch(
    stmts: Array<InStatement | [string, InArgs?]>,
    mode?: TransactionMode,
  ): Promise<Array<ResultSet>> {
    return this.#locked(() => this.inner.batch(stmts, mode));
  }
  migrate(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
    return this.#locked(() => this.inner.migrate(stmts));
  }
  executeMultiple(sql: string): Promise<void> {
    return this.#locked(() => this.inner.executeMultiple(sql));
  }
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
    const scope = txScope.getStore();
    const own = scope?.lock === this.lock ? scope : undefined;
    if (own) own.open = true;
    return new LockedTransaction(tx, () => {
      if (own) own.open = false;
      release();
    });
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
    await client.execute("PRAGMA busy_timeout = 5000");
    await client.execute("SELECT count(*) FROM sqlite_master"); // proves the key opens the file
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA synchronous = FULL");
    await client.execute("PRAGMA secure_delete = ON");
    await client.execute("PRAGMA foreign_keys = ON");
  } catch (e) {
    client?.close();
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
  return txScope.run({ lock: client.lock, open: false }, body);
}

export async function readPragmas(
  db: Db,
): Promise<Record<keyof typeof REQUIRED_PRAGMAS, string | number>> {
  const out = {} as Record<keyof typeof REQUIRED_PRAGMAS, string | number>;
  for (const name of Object.keys(REQUIRED_PRAGMAS) as (keyof typeof REQUIRED_PRAGMAS)[]) {
    const row = (await db.$client.execute(`PRAGMA ${name}`)).rows[0];
    const v = row ? Object.values(row)[0] : null;
    out[name] = typeof v === "bigint" ? Number(v) : (v as string | number);
  }
  return out;
}
