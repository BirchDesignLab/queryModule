import { type SourceStatus, WS_PROTOCOL_VERSION, type WsEvent } from "@querymodule/core/contracts";
import { and, eq, lt, max, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { eventLog } from "../db/schema";
import type { Tx } from "../db/tx";

export type SourceStatusEvent = Extract<WsEvent, { type: "sourceStatus" }>;

/** One sourceStatus outbox row: ids and status only, never a value or payload (spec 5.3). */
export type EventRow = {
  userId: string;
  type: "sourceStatus";
  correlationId: string;
  partId: number;
  sourceId: string;
  resultId: string;
  status: SourceStatus;
  createdAt: number;
};

/** Replay window (spec 5.3): rows older than this are pruned, except each user's newest. */
export const EVENT_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;

async function maxSeq(q: Db | Tx, userId: string): Promise<number> {
  const [r] = await q
    .select({ top: max(eventLog.seq) })
    .from(eventLog)
    .where(eq(eventLog.userId, userId));
  return r?.top ?? 0;
}

/**
 * Inside the caller's transaction: seq = previous max for the user + 1 (single writer, spec 5.3).
 * Returns the event to publish after commit; a rollback leaves no row and publishes nothing.
 */
export async function appendEvent(tx: Tx, row: EventRow): Promise<SourceStatusEvent> {
  const seq = (await maxSeq(tx, row.userId)) + 1;
  await tx.insert(eventLog).values({ ...row, seq });
  return {
    v: WS_PROTOCOL_VERSION,
    type: row.type,
    seq,
    at: row.createdAt,
    correlationId: row.correlationId,
    partId: row.partId,
    sourceId: row.sourceId,
    resultId: row.resultId,
    status: row.status,
  };
}

/** The user's newest seq, 0 when the user has no row (welcome.latestSeq, spec 5.3). */
export function latestSeq(db: Db, userId: string): Promise<number> {
  return maxSeq(db, userId);
}

/** Deletes rows older than now - 24 h, except each user's newest row, so seq never restarts (D-A14). */
export async function pruneEventLog(tx: Tx, now: number): Promise<number> {
  const r = await tx.delete(eventLog).where(
    and(
      lt(eventLog.createdAt, now - EVENT_LOG_RETENTION_MS),
      // a newer row of the same user exists, so this one is not the seq high-water mark
      sql`EXISTS (SELECT 1 FROM event_log AS newer WHERE newer.user_id = event_log.user_id AND newer.seq > event_log.seq)`,
    ),
  );
  return r.rowsAffected;
}
