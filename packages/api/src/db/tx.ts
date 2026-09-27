import { type Db, inTransactionScope } from "./client";

/** Drizzle's transaction handle for this schema. Inside withTransaction, use it, never db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs fn in one IMMEDIATE transaction on the single connection; commits when fn resolves,
 * rolls back when it throws. Never nest it: a nested call, or a plain db call from inside
 * fn, throws NestedTransactionError ("use tx inside withTransaction").
 */
export function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransactionScope(db, () => db.transaction(fn, { behavior: "immediate" }));
}
