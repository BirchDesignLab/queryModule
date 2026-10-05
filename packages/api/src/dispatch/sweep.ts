import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import { sourceResult } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { appendEvent, pruneEventLog } from "./event-log";

/**
 * Startup sweep (spec 5.2; NFR-003, SEC-010, SEC-012): in one transaction, every `pending`
 * source_result becomes `interrupted` (received_at = now), with one `interrupted` audit row per
 * result by the system actor naming the row's credential owner, and one sourceStatus event_log
 * row for the row's owner; then the event log is pruned. Any throw rolls all of it back. Nothing
 * is re-dispatched (D-A13) and nothing is published: no socket exists yet, so clients get the
 * events on replay. Called from bootstrap() only, never loadDeps(): the ops scripts load deps
 * while the server runs and must never settle a live process's in-flight rows.
 */
export async function sweepPending(d: AppDeps): Promise<{ interrupted: number; pruned: number }> {
  return withTransaction(d.db, async (tx) => {
    const now = d.clock.now();
    // The write-once trigger allows this update: every row is still pending, and only status and
    // received_at change.
    const swept = await tx
      .update(sourceResult)
      .set({ status: "interrupted", receivedAt: now })
      .where(eq(sourceResult.status, "pending"))
      .returning();
    // RETURNING order is unspecified; sort so each owner's seqs follow the submit order.
    swept.sort((a, b) => a.createdAt - b.createdAt || a.resultId.localeCompare(b.resultId));
    for (const r of swept) {
      await d.audit.record(tx, {
        type: "interrupted",
        correlationId: r.correlationId,
        partId: r.partId,
        actor: SYSTEM_ACTOR,
        identitySource: "system",
        ...(r.credentialUserId !== null ? { credentialUserId: r.credentialUserId } : {}),
        details: {
          partId: r.partId,
          sourceId: r.sourceId,
          resultId: r.resultId,
          reason: "processRestart",
        },
      });
      await appendEvent(tx, {
        userId: r.userId,
        type: "sourceStatus",
        correlationId: r.correlationId,
        partId: r.partId,
        sourceId: r.sourceId,
        resultId: r.resultId,
        status: "interrupted",
        createdAt: now,
      });
    }
    const pruned = await pruneEventLog(tx, now);
    return { interrupted: swept.length, pruned };
  });
}
