import { and, eq } from "drizzle-orm";
import { requestKey, sourceResult } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { seal } from "../keys/aead";
import { payloadAad, unwrapRequestKey } from "../keys/request-keys";
import { errorFields } from "../log/error-fields";
import type { EventBus } from "../seams";
import type { DispatchJob, Outcome } from "./dispatcher";
import { appendEvent, type SourceStatusEvent } from "./event-log";

/** The ids of one outcome write; ids only, safe for a log line (spec 5.9). */
export interface OutcomeIds {
  correlationId: string;
  resultId: string;
  sourceId: string;
  partId: number;
}

/**
 * What a failed T2 hands to d.fatal: fixed message, the ids, and the failing error's class name
 * only, never its message or cause, which can quote payload or query values (spec 5.9).
 */
export class OutcomeWriteError extends Error {
  constructor(
    readonly ids: OutcomeIds,
    readonly causeName: string,
  ) {
    super("dispatch outcome write failed");
    this.name = "OutcomeWriteError";
  }
}

/** Fixed message: the request has no payload key row (never carries an id, spec 5.9). */
class PayloadKeyMissingError extends Error {
  constructor() {
    super("payload request key missing");
    this.name = "PayloadKeyMissingError";
  }
}

/**
 * One slot per committed-or-failed T2 that appended an event, in the order the T2s held the
 * write lock (db/tx.ts), which is the order their seqs were assigned. A slot publishes only once
 * every earlier slot has settled, so each user's sockets get sourceStatus in seq order (spec 4.7,
 * ADR-0013: clients drop a seq below their high-water mark).
 */
interface Slot {
  userId: string;
  event: SourceStatusEvent | null;
  settled: boolean;
}
const outboxes = new WeakMap<EventBus, Slot[]>();

function outboxOf(bus: EventBus): Slot[] {
  let q = outboxes.get(bus);
  if (!q) {
    q = [];
    outboxes.set(bus, q);
  }
  return q;
}

function flush(bus: EventBus, q: Slot[]): void {
  while (q[0]?.settled) {
    const s = q.shift() as Slot;
    if (s.event) bus.publish(s.userId, s.event);
  }
}

/**
 * Transaction T2 (spec 5.2 step 6; FR-043, SEC-010, SEC-011, SEC-012): in one IMMEDIATE
 * transaction, the write-once update of the pending source_result row (a returned payload sealed
 * under the request's payload DEK), a sourceResponded audit row by the requester's envelope naming
 * the credential owner, and a sourceStatus event_log row. Zero rows updated: nothing else is written.
 * The event is published only after the commit, in seq order. Any throw rolls everything back,
 * leaves the row pending for the startup sweep, logs ids and the error class only, and calls
 * d.fatal (fail closed). The DEK and the plaintext payload buffer are zeroed in finally; the
 * JSON string the buffer is made from is a JS string and cannot be zeroed (AW3 critic m3).
 */
export async function recordOutcome(
  d: AppDeps,
  job: DispatchJob,
  o: Outcome,
  latencyMs: number,
): Promise<void> {
  const ids: OutcomeIds = {
    correlationId: job.correlationId,
    resultId: job.resultId,
    sourceId: job.sourceId,
    partId: job.partId,
  };
  const q = outboxOf(d.eventBus);
  /** Set inside the transaction; a holder, so the catch sees a slot taken before a failed commit. */
  const mine: { slot?: Slot } = {};
  try {
    await withTransaction(d.db, async (tx) => {
      const now = d.clock.now();
      let sealed: { ciphertext: Buffer; iv: Buffer; tag: Buffer } | null = null;
      if (o.status === "returned") {
        const [row] = await tx
          .select()
          .from(requestKey)
          .where(
            and(eq(requestKey.correlationId, job.correlationId), eq(requestKey.scope, "payload")),
          );
        if (!row) throw new PayloadKeyMissingError();
        let dek: Buffer | undefined;
        const plaintext = Buffer.from(JSON.stringify(o.payload), "utf8");
        try {
          dek = unwrapRequestKey(d.dataKey, row);
          sealed = seal(dek, plaintext, payloadAad(job.resultId));
        } finally {
          dek?.fill(0);
          plaintext.fill(0);
        }
      }
      const errorCode = "errorCode" in o ? o.errorCode : null;
      const updated = await tx
        .update(sourceResult)
        .set({
          status: o.status,
          payloadCiphertext: sealed?.ciphertext ?? null,
          payloadIv: sealed?.iv ?? null,
          payloadTag: sealed?.tag ?? null,
          errorCode,
          receivedAt: now,
          timedOutAt: o.status === "timedOut" ? now : null,
        })
        .where(and(eq(sourceResult.resultId, job.resultId), eq(sourceResult.status, "pending")));
      if (updated.rowsAffected === 0) return;
      await d.audit.record(tx, {
        type: "sourceResponded",
        correlationId: job.correlationId,
        partId: job.partId,
        actor: job.actor,
        identitySource: job.identitySource,
        ...(job.hostSubject !== undefined ? { hostSubject: job.hostSubject } : {}),
        ...(job.credentialUserId !== null ? { credentialUserId: job.credentialUserId } : {}),
        details: {
          partId: job.partId,
          sourceId: job.sourceId,
          resultId: job.resultId,
          status: o.status,
          latencyMs: Math.max(0, Math.round(latencyMs)),
          credentialOwnerUserId: job.credentialUserId,
          delegationId: job.delegationId,
          adapterKind: job.adapterKind,
          ...(errorCode !== null ? { errorCode } : {}),
        },
      });
      const event = await appendEvent(tx, {
        userId: job.userId,
        type: "sourceStatus",
        correlationId: job.correlationId,
        partId: job.partId,
        sourceId: job.sourceId,
        resultId: job.resultId,
        status: o.status,
        createdAt: now,
      });
      // Taken while this T2 still holds the write lock, so slots line up in seq order.
      mine.slot = { userId: job.userId, event, settled: false };
      q.push(mine.slot);
    });
    if (mine.slot) {
      mine.slot.settled = true;
      flush(d.eventBus, q);
    }
  } catch (e) {
    if (mine.slot) {
      // the commit failed after the event was taken: nothing was written, so nothing is published
      mine.slot.event = null;
      mine.slot.settled = true;
      flush(d.eventBus, q);
    }
    const name = errorFields(e).name;
    d.logger.error("dispatch outcome write failed", { ...ids, error: { name } });
    d.fatal(new OutcomeWriteError(ids, name));
  }
}
