import {
  type RESYNC_REASONS,
  type SourceStatus,
  WS_PROTOCOL_VERSION,
  type WsEvent,
  WsEventSchema,
} from "@querymodule/core/contracts";
import { and, asc, eq, gt, gte, lt, max, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { eventLog } from "../db/schema";
import { type Tx, withTransaction } from "../db/tx";

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

/** Replay cap (spec 5.3): more rows due than this gets resync tooMany. */
export const REPLAY_MAX_EVENTS = 500;

export type ReplayResult = { latestSeq: number } & (
  | { kind: "events"; events: WsEvent[] }
  | { kind: "resync"; reason: (typeof RESYNC_REASONS)[number] }
);

/**
 * The owner's missed events after lastSeq (spec 4.7, 5.3; FR-043, FR-065, SEC-014), read in one
 * transaction so latestSeq and the rows agree. Owner rows only (user_id = userId), in seq order,
 * each re-validated with WsEventSchema (server strict, ADR-0013); a row that fails throws.
 * lastSeq above latestSeq: unknownCursor. Equal: nothing due, even when the newest row is older
 * than the window. 0: the rows within the window. Above 0: tooOld when row lastSeq + 1 is pruned
 * or older than the window. More than REPLAY_MAX_EVENTS due: tooMany.
 * Hidden results: no filter until result_visibility exists (M3 P2); replay must then skip the
 * sourceStatus rows of hidden results (spec 5.3).
 */
export function eventsSince(
  db: Db,
  userId: string,
  lastSeq: number,
  now: number,
): Promise<ReplayResult> {
  const windowStart = now - EVENT_LOG_RETENTION_MS;
  return withTransaction(db, async (tx): Promise<ReplayResult> => {
    const latest = await maxSeq(tx, userId);
    if (lastSeq > latest) return { latestSeq: latest, kind: "resync", reason: "unknownCursor" };
    if (lastSeq === latest) return { latestSeq: latest, kind: "events", events: [] };
    const rows = await tx
      .select()
      .from(eventLog)
      .where(
        and(
          eq(eventLog.userId, userId),
          gt(eventLog.seq, lastSeq),
          // lastSeq 0 asks for everything within the window; older rows are skipped, not tooOld
          lastSeq === 0 ? gte(eventLog.createdAt, windowStart) : undefined,
        ),
      )
      .orderBy(asc(eventLog.seq))
      .limit(REPLAY_MAX_EVENTS + 1);
    const first = rows[0];
    if (lastSeq > 0 && (first?.seq !== lastSeq + 1 || first.createdAt < windowStart)) {
      return { latestSeq: latest, kind: "resync", reason: "tooOld" };
    }
    if (rows.length > REPLAY_MAX_EVENTS) {
      return { latestSeq: latest, kind: "resync", reason: "tooMany" };
    }
    const events = rows.map((r) =>
      WsEventSchema.parse({
        v: WS_PROTOCOL_VERSION,
        type: r.type,
        seq: r.seq,
        at: r.createdAt,
        correlationId: r.correlationId,
        partId: r.partId,
        sourceId: r.sourceId,
        resultId: r.resultId,
        status: r.status,
      }),
    );
    return { latestSeq: latest, kind: "events", events };
  });
}
