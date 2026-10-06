import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../src/db/client";
import { queryRequest, requestKey, sourceResult } from "../../src/db/schema";
import { uuidv7 } from "../../src/ids";
import { open } from "../../src/keys/aead";
import { payloadAad, unwrapRequestKey } from "../../src/keys/request-keys";
import { TEST_SECRETS } from "./fixture";
import type { TestApp } from "./test-app";

/** One source_result row of a request, its sealed payload opened (null when none). */
export interface OpenedResult {
  partId: number;
  sourceId: string;
  status: string;
  timedOutAt: number | null;
  payload: unknown;
}

/**
 * Every source_result row of the request, ordered by part then source, each payload opened with
 * the request's payload DEK (unwrapped with the test data key) under its row's AAD.
 */
export async function openResults(t: TestApp, correlationId: string): Promise<OpenedResult[]> {
  const [key] = await t.deps.db
    .select()
    .from(requestKey)
    .where(and(eq(requestKey.correlationId, correlationId), eq(requestKey.scope, "payload")));
  if (!key) throw new Error("no payload request key");
  const dek = unwrapRequestKey(TEST_SECRETS.dataKey, key);
  const rows = await t.deps.db
    .select()
    .from(sourceResult)
    .where(eq(sourceResult.correlationId, correlationId))
    .orderBy(asc(sourceResult.partId), asc(sourceResult.sourceId));
  return rows.map((r) => ({
    partId: r.partId,
    sourceId: r.sourceId,
    status: r.status,
    timedOutAt: r.timedOutAt,
    payload:
      r.payloadCiphertext && r.payloadIv && r.payloadTag
        ? (JSON.parse(
            open(
              dek,
              { ciphertext: r.payloadCiphertext, iv: r.payloadIv, tag: r.payloadTag },
              payloadAad(r.resultId),
            ).toString("utf8"),
          ) as unknown)
        : null,
  }));
}

/** One source_result row seeded straight into the database, with its query_request part. */
export interface SeededResult {
  correlationId: string;
  partId: number;
  sourceId: string;
  resultId: string;
  userId: string;
  credentialUserId: string | null;
  createdAt: number;
}

/**
 * Inserts a query_request part and one source_result row for it (status `pending` unless given),
 * as a T1 that committed and whose T2 never did. Mock ids and synthetic values only (spec 5.4).
 */
export async function seedResult(
  db: Db,
  o: {
    userId: string;
    credentialUserId?: string | null;
    partId?: number;
    sourceId?: string;
    status?: "pending" | "returned";
    createdAt?: number;
  },
): Promise<SeededResult> {
  const createdAt = o.createdAt ?? Date.now();
  const r: SeededResult = {
    correlationId: uuidv7(createdAt),
    partId: o.partId ?? 0,
    sourceId: o.sourceId ?? "stateSource",
    resultId: uuidv7(createdAt),
    userId: o.userId,
    credentialUserId: o.credentialUserId ?? null,
    createdAt,
  };
  await db.insert(queryRequest).values({
    correlationId: r.correlationId,
    partId: r.partId,
    userId: r.userId,
    origin: "primary",
    queryType: "VEH",
    typeValues: {},
    plateOnly: 1,
    selectedSourceIds: [r.sourceId],
    droppedSourceIds: [],
    configHash: "seeded",
    submittedAt: createdAt,
  });
  const status = o.status ?? "pending";
  await db.insert(sourceResult).values({
    resultId: r.resultId,
    correlationId: r.correlationId,
    partId: r.partId,
    sourceId: r.sourceId,
    userId: r.userId,
    status,
    credentialUserId: r.credentialUserId,
    adapterKind: "mock",
    createdAt,
    ...(status === "returned" ? { receivedAt: createdAt } : {}),
  });
  return r;
}
