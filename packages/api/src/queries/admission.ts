import {
  BoundedIdSchema,
  IdempotencyKeySchema,
  parseAuditDetails,
  type SubmitQueryResponse,
  SubmitQueryResponseSchema,
} from "@querymodule/core/contracts";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { systemMonotonic } from "../clock";
import type { Db } from "../db/client";
import { auditEvent, queryRequest, sourceResult } from "../db/schema";
import type { Tx } from "../db/tx";
import type { AppDeps } from "../deps";
import { apiError, rateLimited } from "../http/errors";
import type { AppEnv } from "../http/types";

/** Per-user submit limit, default 30 per minute (spec 5.2 step 1). */
export const QUERY_LIMIT = { limit: 30, windowMs: 60_000 } as const;
/** Per-value cap in UTF-8 bytes (spec 5.9). */
export const MAX_VALUE_BYTES = 4096;

export type Admission =
  // the original 202; no new writes
  | { kind: "replay"; body: SubmitQueryResponse }
  | {
      kind: "admit";
      idempotencyKey: string;
      raw: unknown;
      receivedAt: number;
      receivedMono: number;
    }
  | { kind: "reject"; response: Response };

const SourceIdsSchema = z.array(BoundedIdSchema);

/**
 * Submit admission (spec 5.2 step 1), after requireSession, the X-Requested-With check and the
 * 32 KB body cap: parse JSON, per-value cap, per-user limit, Idempotency-Key, then replay.
 * Nothing but `values` string lengths is read from the body here, and nothing is logged from it.
 */
export async function admitSubmit(c: Context<AppEnv>, d: AppDeps): Promise<Admission> {
  const receivedAt = d.clock.now();
  const receivedMono = systemMonotonic.nowMs();
  const text = await c.req.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return reject(apiError(c, "validationFailed", undefined, [{ key: "validation.invalidBody" }]));
  }
  if (hasOversizedValue(raw)) return reject(apiError(c, "payloadTooLarge"));
  const userId = c.get("principal").userId;
  const gate = await d.limiter.hit(
    `queries:user:${userId}`,
    QUERY_LIMIT.limit,
    QUERY_LIMIT.windowMs,
  );
  if (!gate.allowed) return reject(rateLimited(c, gate.retryAfterSeconds));
  const key = IdempotencyKeySchema.safeParse(c.req.header("idempotency-key"));
  if (!key.success) {
    return reject(
      apiError(c, "validationFailed", undefined, [{ key: "validation.idempotencyKey" }]),
    );
  }
  const body = await replayResponse(d.db, userId, key.data);
  if (body) return { kind: "replay", body };
  return { kind: "admit", idempotencyKey: key.data, raw, receivedAt, receivedMono };
}

/** Rebuilds the original 202 from the part rows, their source_result rows and the acknowledged audit row. */
export async function replayResponse(
  db: Db | Tx,
  userId: string,
  idempotencyKey: string,
): Promise<SubmitQueryResponse | null> {
  // part_id = 0 in the WHERE lets SQLite use the partial unique index query_request_idempotency_idx
  const [head] = await db
    .select({ correlationId: queryRequest.correlationId })
    .from(queryRequest)
    .where(
      and(
        eq(queryRequest.userId, userId),
        eq(queryRequest.idempotencyKey, idempotencyKey),
        eq(queryRequest.partId, 0),
      ),
    );
  if (!head) return null;
  const correlationId = head.correlationId;
  const parts = await db
    .select({
      partId: queryRequest.partId,
      queryType: queryRequest.queryType,
      selectedSourceIds: queryRequest.selectedSourceIds,
      droppedSourceIds: queryRequest.droppedSourceIds,
      skippedReason: queryRequest.skippedReason,
    })
    .from(queryRequest)
    .where(eq(queryRequest.correlationId, correlationId))
    .orderBy(queryRequest.partId);
  const results = await db
    .select({ partId: sourceResult.partId, sourceId: sourceResult.sourceId })
    .from(sourceResult)
    .where(eq(sourceResult.correlationId, correlationId));
  const [ack] = await db
    .select({ details: auditEvent.details })
    .from(auditEvent)
    .where(and(eq(auditEvent.correlationId, correlationId), eq(auditEvent.type, "acknowledged")));
  if (!ack) throw new Error("replay: acknowledged audit row missing");
  const { acknowledgedAt } = parseAuditDetails("acknowledged", ack.details);
  return SubmitQueryResponseSchema.parse({
    correlationId,
    acknowledgedAt,
    parts: parts.map((p) => {
      const droppedSourceIds = SourceIdsSchema.parse(p.droppedSourceIds);
      if (p.skippedReason !== null) {
        return {
          partId: p.partId,
          queryType: p.queryType,
          status: "skipped",
          sourceIds: [],
          droppedSourceIds,
        };
      }
      // plan order: the part's selection order, not source_result insert order
      const selected = SourceIdsSchema.parse(p.selectedSourceIds);
      const sourceIds = results
        .filter((r) => r.partId === p.partId)
        .map((r) => r.sourceId)
        .sort((a, b) => selected.indexOf(a) - selected.indexOf(b));
      return {
        partId: p.partId,
        queryType: p.queryType,
        status: "dispatched",
        sourceIds,
        droppedSourceIds,
      };
    }),
  });
}

function reject(response: Response): Admission {
  return { kind: "reject", response };
}

function hasOversizedValue(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || !("values" in raw)) return false;
  const values = raw.values;
  if (typeof values !== "object" || values === null) return false;
  return Object.values(values).some(
    (v) => typeof v === "string" && Buffer.byteLength(v, "utf8") > MAX_VALUE_BYTES,
  );
}
