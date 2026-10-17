import {
  AuditValidationErrorSchema,
  BoundedIdSchema,
  EpochMsSchema,
  type QueryDetail,
  QueryDetailSchema,
  type QueryListResponse,
  QueryListResponseSchema,
  Uuid7Schema,
} from "@querymodule/core/contracts";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
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

/** The query_request columns both reads map the same way (#623 Q1). */
interface PartRow {
  partId: number;
  parentPartId: number | null;
  origin: string;
  queryType: string;
  typeValues: unknown;
  plateOnly: number;
  skippedReason: unknown;
  droppedSourceIds: unknown;
}

/**
 * One part's fields shared by the detail read and the list (#623 Q1), so the two cannot drift: a
 * skipped part carries its skipReasons, an unskipped one an empty list.
 */
function partFields(p: PartRow) {
  return {
    partId: p.partId,
    parentPartId: p.parentPartId,
    origin: p.origin,
    queryType: p.queryType,
    typeValues: p.typeValues,
    plateOnly: p.plateOnly === 1,
    skipReasons: p.skippedReason === null ? [] : SkipReasonsSchema.parse(p.skippedReason),
    droppedSourceIds: SourceIdsSchema.parse(p.droppedSourceIds),
  };
}

/** A part's results in selection order, as the 202 lists them (spec 5.2). */
function inSelectionOrder<R extends { sourceId: string }>(
  rows: readonly R[],
  selectedSourceIds: unknown,
): R[] {
  const selected = SourceIdsSchema.parse(selectedSourceIds);
  return [...rows].sort((a, b) => selected.indexOf(a.sourceId) - selected.indexOf(b.sourceId));
}

/**
 * The one purged rule (spec 5.1), shared by both reads: a part or result that holds sealed data
 * whose request_key scope is gone (shredded by ops/lost-key.ts).
 */
const isPurged = (sealed: boolean, keyPresent: boolean): boolean => sealed && !keyPresent;

/**
 * Rows grouped by a key, in their original order (#623 Q4: one pass, not a filter per item); the
 * lookup answers an empty list for a key with no rows (a skipped part has no results).
 */
function groupBy<R>(
  rows: readonly R[],
  key: (r: R) => string | number,
): (k: string | number) => R[] {
  const m = new Map<string | number, R[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return (k) => m.get(k) ?? [];
}

/**
 * The owner's read of one request (spec 5.1, 5.2, 5.5; FR-062 read half): null unless
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
  const resultsByPart = groupBy(results, (r) => r.partId);
  try {
    for (const row of keys) deks[row.scope] = unwrapRequestKey(d.dataKey, row);
    return QueryDetailSchema.parse({
      correlationId,
      submittedAt: head?.submittedAt,
      configHash: head?.configHash,
      parts: parts.map((p) => {
        const sealedValues = sealedOf(p.valuesCiphertext, p.valuesIv, p.valuesTag);
        const sources = inSelectionOrder(resultsByPart(p.partId), p.selectedSourceIds).map((r) => {
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
          if (sealedPayload === null || !deks.payload) {
            return {
              ...base,
              purged: isPurged(sealedPayload !== null, deks.payload !== undefined),
            };
          }
          return {
            ...base,
            purged: false,
            payload: openPayload(deks.payload, r.resultId, sealedPayload),
          };
        });
        const base = { ...partFields(p), sources };
        // a skipped part has no values ciphertext (acknowledge.ts), so nothing to open or purge
        if (sealedValues === null || !deks.values) {
          return { ...base, purged: isPurged(sealedValues !== null, deks.values !== undefined) };
        }
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

/** The list's default page size (spec 5.1); the contract caps limit at 100 (#561). */
export const QUERY_LIST_DEFAULT_LIMIT = 25;

/** The decoded list cursor: the last item of the previous page (spec 5.1). */
const ListCursorSchema = z.strictObject({ submittedAt: EpochMsSchema, correlationId: Uuid7Schema });
type ListCursor = z.infer<typeof ListCursorSchema>;

const encodeCursor = (c: ListCursor): string =>
  Buffer.from(JSON.stringify(c), "utf8").toString("base64url");

/**
 * The opaque cursor back to its position, or null when it is not one this route issued (the
 * route answers 400 validationFailed, never 500). It only names a position: the list always
 * filters by the caller, so another user's cursor only shifts where the caller's page starts.
 */
export function decodeListCursor(cursor: string): ListCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const parsed = ListCursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The caller's requests, newest first by (submitted_at, correlation_id) over
 * query_request_user_submitted_idx, cursor paged (spec 5.1, 6.7; FR-043, FR-065; #561, #589).
 * Every row read is filtered by the caller's user_id, so only the owner's requests are listed.
 * Parts in plan order with per-source status and typeValues; no values and no payloads, so no
 * sealed column is read and no DEK is unwrapped. purged follows the detail read: a part or result
 * that holds sealed data whose request_key scope is gone. No hidden-result filter until
 * result_visibility lands (M3 P2). Writes nothing: the owner's read is not audited (spec 5.2).
 */
export async function listQueries(
  d: AppDeps,
  principal: Principal,
  page: { cursor?: ListCursor; limit?: number },
): Promise<QueryListResponse> {
  const limit = page.limit ?? QUERY_LIST_DEFAULT_LIMIT;
  const mine = eq(queryRequest.userId, principal.userId);
  const after = page.cursor
    ? or(
        lt(queryRequest.submittedAt, page.cursor.submittedAt),
        and(
          eq(queryRequest.submittedAt, page.cursor.submittedAt),
          lt(queryRequest.correlationId, page.cursor.correlationId),
        ),
      )
    : undefined;
  const heads = await d.db
    .select({ correlationId: queryRequest.correlationId, submittedAt: queryRequest.submittedAt })
    .from(queryRequest)
    .where(and(mine, eq(queryRequest.partId, 0), after))
    .orderBy(desc(queryRequest.submittedAt), desc(queryRequest.correlationId))
    .limit(limit + 1);
  const pageHeads = heads.slice(0, limit);
  const last = pageHeads.at(-1);
  const nextCursor = heads.length > limit && last ? encodeCursor(last) : null;
  const ids = pageHeads.map((h) => h.correlationId);
  if (ids.length === 0) return QueryListResponseSchema.parse({ requests: [], nextCursor });
  const parts = await d.db
    .select({
      correlationId: queryRequest.correlationId,
      partId: queryRequest.partId,
      parentPartId: queryRequest.parentPartId,
      origin: queryRequest.origin,
      queryType: queryRequest.queryType,
      typeValues: queryRequest.typeValues,
      plateOnly: queryRequest.plateOnly,
      selectedSourceIds: queryRequest.selectedSourceIds,
      droppedSourceIds: queryRequest.droppedSourceIds,
      skippedReason: queryRequest.skippedReason,
      configHash: queryRequest.configHash,
      submittedAt: queryRequest.submittedAt,
      sealed: sql<number>`${queryRequest.valuesCiphertext} IS NOT NULL`,
    })
    .from(queryRequest)
    .where(and(mine, inArray(queryRequest.correlationId, ids)))
    .orderBy(asc(queryRequest.partId));
  const results = await d.db
    .select({
      resultId: sourceResult.resultId,
      correlationId: sourceResult.correlationId,
      partId: sourceResult.partId,
      sourceId: sourceResult.sourceId,
      status: sourceResult.status,
      adapterKind: sourceResult.adapterKind,
      errorCode: sourceResult.errorCode,
      createdAt: sourceResult.createdAt,
      receivedAt: sourceResult.receivedAt,
      timedOutAt: sourceResult.timedOutAt,
      sealed: sql<number>`${sourceResult.payloadCiphertext} IS NOT NULL`,
    })
    .from(sourceResult)
    .where(
      and(eq(sourceResult.userId, principal.userId), inArray(sourceResult.correlationId, ids)),
    );
  const keys = await d.db
    .select({ correlationId: requestKey.correlationId, scope: requestKey.scope })
    .from(requestKey)
    .where(inArray(requestKey.correlationId, ids));
  const keySet = new Set(keys.map((k) => `${k.correlationId}/${k.scope}`));
  const hasKey = (correlationId: string, scope: RequestKeyScope) =>
    keySet.has(`${correlationId}/${scope}`);
  const partsByRequest = groupBy(parts, (p) => p.correlationId);
  const resultsByPart = groupBy(results, (r) => `${r.correlationId}/${r.partId}`);
  return QueryListResponseSchema.parse({
    nextCursor,
    requests: pageHeads.map((h) => {
      const own = partsByRequest(h.correlationId);
      const head = own.find((p) => p.partId === 0);
      return {
        correlationId: h.correlationId,
        submittedAt: h.submittedAt,
        configHash: head?.configHash,
        parts: own.map((p) => ({
          ...partFields(p),
          purged: isPurged(p.sealed === 1, hasKey(h.correlationId, "values")),
          sources: inSelectionOrder(
            resultsByPart(`${h.correlationId}/${p.partId}`),
            p.selectedSourceIds,
          ).map(({ correlationId: _c, partId: _p, sealed, ...r }) => ({
            ...r,
            purged: isPurged(sealed === 1, hasKey(h.correlationId, "payload")),
          })),
        })),
      };
    }),
  });
}
