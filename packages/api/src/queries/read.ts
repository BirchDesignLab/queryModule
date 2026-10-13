import {
  AuditValidationErrorSchema,
  BoundedIdSchema,
  type QueryDetail,
  QueryDetailSchema,
} from "@querymodule/core/contracts";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { queryRequest, requestKey, sourceResult } from "../db/schema";
import type { AppDeps } from "../deps";
import { open } from "../keys/aead";
import {
  openPartValues,
  payloadAad,
  type RequestKeyScope,
  unwrapRequestKey,
} from "../keys/request-keys";
import type { Principal } from "../seams";
import { authorizeQueryAccess } from "./policy";

const SourceIdsSchema = z.array(BoundedIdSchema);
/** skipped_reason holds the planner's skipReasons; a stored list is never empty (spec 4.6 step 5). */
const SkipReasonsSchema = z.array(AuditValidationErrorSchema).min(1);

/** A stored row that cannot be read back; the message is fixed text, never row contents (spec 5.9). */
export class QueryReadError extends Error {
  constructor(message: "sealed columns incomplete" | "payload is not valid JSON") {
    super(`query read: ${message}`);
    this.name = "QueryReadError";
  }
}

type Sealed = { ciphertext: Buffer; iv: Buffer; tag: Buffer };

/** The three sealed columns of a row, or null when it holds none; a partial set is a fault. */
function sealedOf(c: Buffer | null, iv: Buffer | null, tag: Buffer | null): Sealed | null {
  if (c === null && iv === null && tag === null) return null;
  if (c === null || iv === null || tag === null)
    throw new QueryReadError("sealed columns incomplete");
  return { ciphertext: c, iv, tag };
}

/**
 * The owner's read of one request (spec 5.1, 5.2, 5.5; FR-062 read half, SEC-014): null unless
 * the access policy answers basis "owner", so another user, an admin on this route and an unknown
 * or malformed id all get the same 404 (never 403). Parts in plan order, each part's sources in
 * selection order (as the 202 lists them), values opened under the values DEK and each returned
 * payload under the payload DEK; both DEKs are zeroed in finally. A scope whose request_key row is
 * gone (shredded by ops/lost-key.ts) answers purged: true with no values or payload for the parts
 * or results that held sealed data in it (spec 5.1). No hidden-result filter until
 * result_visibility lands (M3 P2), and no retention purge until M2 P2. Writes nothing: the
 * owner's read is not audited (spec 5.2). Decrypted values and payloads exist only in the
 * returned body; a decrypt or parse failure throws for the route to log by class and ids.
 */
export async function readQuery(
  d: AppDeps,
  principal: Principal,
  correlationId: string,
): Promise<QueryDetail | null> {
  const access = await authorizeQueryAccess(d.db, principal, correlationId, "read", "own");
  if (!access.ok || access.basis !== "owner") return null;
  const parts = await d.db
    .select()
    .from(queryRequest)
    .where(eq(queryRequest.correlationId, correlationId))
    .orderBy(asc(queryRequest.partId));
  const results = await d.db
    .select()
    .from(sourceResult)
    .where(eq(sourceResult.correlationId, correlationId));
  const keys = await d.db
    .select()
    .from(requestKey)
    .where(eq(requestKey.correlationId, correlationId));
  // the policy found part 0, so head is there; were it not, the schema refuses the body (500)
  const head = parts[0];
  const deks: Partial<Record<RequestKeyScope, Buffer>> = {};
  try {
    for (const row of keys) deks[row.scope] = unwrapRequestKey(d.dataKey, row);
    return QueryDetailSchema.parse({
      correlationId,
      submittedAt: head?.submittedAt,
      configHash: head?.configHash,
      parts: parts.map((p) => {
        const sealedValues = sealedOf(p.valuesCiphertext, p.valuesIv, p.valuesTag);
        const selected = SourceIdsSchema.parse(p.selectedSourceIds);
        const sources = results
          .filter((r) => r.partId === p.partId)
          .sort((a, b) => selected.indexOf(a.sourceId) - selected.indexOf(b.sourceId))
          .map((r) => {
            const sealedPayload = sealedOf(r.payloadCiphertext, r.payloadIv, r.payloadTag);
            const base = {
              resultId: r.resultId,
              sourceId: r.sourceId,
              status: r.status,
              adapterKind: r.adapterKind,
              errorCode: r.errorCode,
              createdAt: r.createdAt,
              receivedAt: r.receivedAt,
              timedOutAt: r.timedOutAt,
            };
            if (sealedPayload === null) return { ...base, purged: false };
            if (!deks.payload) return { ...base, purged: true };
            return {
              ...base,
              purged: false,
              payload: openPayload(deks.payload, r.resultId, sealedPayload),
            };
          });
        const base = {
          partId: p.partId,
          parentPartId: p.parentPartId,
          origin: p.origin,
          queryType: p.queryType,
          typeValues: p.typeValues,
          plateOnly: p.plateOnly === 1,
          skipReasons: p.skippedReason === null ? [] : SkipReasonsSchema.parse(p.skippedReason),
          droppedSourceIds: SourceIdsSchema.parse(p.droppedSourceIds),
          sources,
        };
        // a skipped part has no values ciphertext (acknowledge.ts), so nothing to open or purge
        if (sealedValues === null) return { ...base, purged: false };
        if (!deks.values) return { ...base, purged: true };
        return {
          ...base,
          purged: false,
          values: openPartValues(deks.values, correlationId, p.partId, sealedValues),
        };
      }),
    });
  } finally {
    deks.values?.fill(0);
    deks.payload?.fill(0);
  }
}

/**
 * Opens one returned payload; its shape is the schema's to check. The plaintext buffer is zeroed,
 * and a parse error never quotes it (a JSON.parse message carries its input, spec 5.9).
 */
function openPayload(dek: Buffer, resultId: string, s: Sealed): unknown {
  const pt = open(dek, s, payloadAad(resultId));
  try {
    return JSON.parse(pt.toString("utf8")) as unknown;
  } catch {
    throw new QueryReadError("payload is not valid JSON");
  } finally {
    pt.fill(0);
  }
}
