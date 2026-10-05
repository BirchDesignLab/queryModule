import type { SubmitQueryResponse } from "@querymodule/core/contracts";
import type { PlanPart } from "@querymodule/core/planner";
import { queryRequest, requestKey, sourceResult } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { uuidv7 } from "../ids";
import { createRequestKeys, sealPartValues } from "../keys/request-keys";
import { actorOf, type Principal } from "../seams";
import type { PreparedSubmit } from "./prepare";

/** T1's answer: the 202 body, and one entry per pending source_result row for the dispatcher. */
export interface Acknowledged {
  body: SubmitQueryResponse;
  acknowledgedAt: number;
  results: { partId: number; sourceId: string; resultId: string }[];
}

/**
 * Transaction T1 (spec 5.2 step 4): request keys, one query_request row per part, one pending
 * source_result row per pair, then submitted, partSkipped, sourceDispatched and acknowledged
 * audit rows, all in one IMMEDIATE transaction. Any throw, an audit failure included, rolls
 * all of it back (fail closed, SEC-012). Persisted values are the plan's visible effective
 * values and queryType (carry #284), sealed under the values DEK; of the request only
 * sourceIds is read, never request.values or request.queryType.
 */
export async function acknowledge(
  d: AppDeps,
  principal: Principal,
  p: PreparedSubmit,
  a: { idempotencyKey: string; receivedAt: number; receivedMono: number },
): Promise<Acknowledged> {
  const { request, plan, pairs } = p;
  // The hash of the snapshot prepare planned against, even if a publish swapped it since.
  const { configHash } = p.config;
  return withTransaction(d.db, async (tx) => {
    const acknowledgedAt = d.clock.now();
    const correlationId = uuidv7(acknowledgedAt);
    const { rows, deks } = createRequestKeys(d.dataKey, correlationId, acknowledgedAt);
    try {
      await tx.insert(requestKey).values(rows);
      for (const part of plan.parts) {
        const sealed =
          part.status === "planned"
            ? sealPartValues(deks.values, correlationId, part.partId, part.values)
            : null;
        await tx.insert(queryRequest).values({
          correlationId,
          partId: part.partId,
          userId: principal.userId,
          parentPartId: part.parentPartId,
          origin: part.origin,
          queryType: part.queryType,
          typeValues: part.typeValues,
          valuesCiphertext: sealed?.ciphertext ?? null,
          valuesIv: sealed?.iv ?? null,
          valuesTag: sealed?.tag ?? null,
          // per part (carry #285): a nested plate-only part can sit under a normal primary
          plateOnly: part.mode === "plateOnly" ? 1 : 0,
          selectedSourceIds: selectedOf(part, request.sourceIds),
          droppedSourceIds: part.droppedSourceIds,
          skippedReason: part.skipReasons ?? null,
          configHash,
          idempotencyKey: part.partId === 0 ? a.idempotencyKey : null,
          submittedAt: a.receivedAt,
        });
      }
      const dispatched = pairs.map((pair) => ({ ...pair, resultId: uuidv7(acknowledgedAt) }));
      for (const pair of dispatched) {
        await tx.insert(sourceResult).values({
          resultId: pair.resultId,
          correlationId,
          partId: pair.partId,
          sourceId: pair.sourceId,
          userId: principal.userId,
          status: "pending",
          credentialUserId: pair.credentialUserId,
          delegationId: pair.delegationId,
          adapterKind: pair.adapterKind,
          createdAt: acknowledgedAt,
        });
      }
      const env = {
        correlationId,
        actor: actorOf(principal),
        identitySource: principal.identitySource,
        ...(principal.hostSubject ? { hostSubject: principal.hostSubject } : {}),
      };
      for (const part of plan.parts) {
        await d.audit.record(tx, {
          ...env,
          type: "submitted",
          partId: part.partId,
          details: {
            partId: part.partId,
            parentPartId: part.parentPartId,
            origin: part.origin,
            queryType: part.queryType,
            typeValues: part.typeValues,
            selectedSourceIds: selectedOf(part, request.sourceIds),
            dispatchedSourceIds: part.sourceIds,
            droppedSourceIds: part.droppedSourceIds,
            plateOnly: part.mode === "plateOnly",
            configHash,
            ...(part.fieldMapApplied ? { fieldMapApplied: part.fieldMapApplied } : {}),
          },
        });
      }
      for (const part of plan.parts) {
        // the planner sets skipReasons on exactly the skipped parts
        if (part.skipReasons === undefined) continue;
        await d.audit.record(tx, {
          ...env,
          type: "partSkipped",
          partId: part.partId,
          details: {
            partId: part.partId,
            // spec 4.6 step 5: only nested parts are skipped, and a nested part's parent is part 0
            parentPartId: 0,
            queryType: part.queryType,
            typeValues: part.typeValues,
            reasons: part.skipReasons,
          },
        });
      }
      for (const pair of dispatched) {
        await d.audit.record(tx, {
          ...env,
          type: "sourceDispatched",
          partId: pair.partId,
          ...(pair.credentialUserId ? { credentialUserId: pair.credentialUserId } : {}),
          details: {
            partId: pair.partId,
            sourceId: pair.sourceId,
            resultId: pair.resultId,
            credentialOwnerUserId: pair.credentialUserId,
            delegationId: pair.delegationId,
            adapterKind: pair.adapterKind,
          },
        });
      }
      await d.audit.record(tx, {
        ...env,
        type: "acknowledged",
        details: {
          acknowledgedAt,
          ackLatencyMs: Math.max(0, Math.round(d.monotonic.nowMs() - a.receivedMono)),
          partCount: plan.parts.length,
        },
      });
      // the route parses this body with SubmitQueryResponseSchema before sending
      return {
        body: {
          correlationId,
          acknowledgedAt,
          parts: plan.parts.map((part) => ({
            partId: part.partId,
            queryType: part.queryType,
            status: part.status === "planned" ? "dispatched" : "skipped",
            sourceIds: part.sourceIds,
            droppedSourceIds: part.droppedSourceIds,
          })),
        },
        acknowledgedAt,
        results: dispatched.map(({ partId, sourceId, resultId }) => ({
          partId,
          sourceId,
          resultId,
        })),
      };
    } finally {
      deks.values.fill(0);
      deks.payload.fill(0);
    }
  });
}

/** Selection in plan order: part 0 keeps the request's order; a nested part its kept then dropped sources. */
function selectedOf(part: PlanPart, requestSourceIds: string[]): string[] {
  return part.partId === 0 ? requestSourceIds : part.sourceIds.concat(part.droppedSourceIds);
}
