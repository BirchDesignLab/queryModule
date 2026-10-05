import { and, asc, eq } from "drizzle-orm";
import { requestKey, sourceResult } from "../../src/db/schema";
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
