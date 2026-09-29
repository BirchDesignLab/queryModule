import { randomBytes } from "node:crypto";
import type { CanonicalValue } from "@querymodule/core/rules";
import { open, type Sealed, seal } from "./aead";

/** Spec 5.5 request_key: one DEK per scope, wrapped directly under DATA_KEY (SEC-006, SEC-021). */
export const REQUEST_KEY_SCOPES = ["values", "payload"] as const;
export type RequestKeyScope = (typeof REQUEST_KEY_SCOPES)[number];
export const REQUEST_KEY_VERSION = 1;

export interface RequestKeyRow {
  correlationId: string;
  scope: RequestKeyScope;
  wrappedDek: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
  createdAt: number;
}

/** 32 bytes each; the caller zeroes them after use. */
export interface RequestDeks {
  values: Buffer;
  payload: Buffer;
}

export const requestKeyAad = (correlationId: string, scope: RequestKeyScope, keyVersion: number) =>
  `request_key|${correlationId}|${scope}|${keyVersion}`;
export const valuesAad = (correlationId: string, partId: number) =>
  `query_request|${correlationId}|${partId}|values`;
/** Used by the M1 P3 dispatcher. */
export const payloadAad = (resultId: string) => `source_result|${resultId}|payload`;

export function createRequestKeys(
  dataKey: Buffer,
  correlationId: string,
  now: number,
): { rows: RequestKeyRow[]; deks: RequestDeks } {
  const deks: RequestDeks = { values: randomBytes(32), payload: randomBytes(32) };
  const rows = REQUEST_KEY_SCOPES.map((scope): RequestKeyRow => {
    const s = seal(dataKey, deks[scope], requestKeyAad(correlationId, scope, REQUEST_KEY_VERSION));
    return {
      correlationId,
      scope,
      wrappedDek: s.ciphertext,
      iv: s.iv,
      authTag: s.tag,
      keyVersion: REQUEST_KEY_VERSION,
      createdAt: now,
    };
  });
  return { rows, deks };
}

/** AeadError on a wrong key or a row moved to another request, scope or version. */
export function unwrapRequestKey(dataKey: Buffer, row: RequestKeyRow): Buffer {
  return open(
    dataKey,
    { ciphertext: row.wrappedDek, iv: row.iv, tag: row.authTag },
    requestKeyAad(row.correlationId, row.scope, row.keyVersion),
  );
}

export function sealPartValues(
  dek: Buffer,
  correlationId: string,
  partId: number,
  values: Readonly<Record<string, CanonicalValue>>,
): Sealed {
  const sorted = Object.fromEntries(Object.entries(values).sort(([a], [b]) => (a < b ? -1 : 1)));
  return seal(dek, Buffer.from(JSON.stringify(sorted), "utf8"), valuesAad(correlationId, partId));
}

/** Decrypted part values that are not JSON. Fixed message: a JSON.parse error quotes its input (spec 5.9). */
export class PartValuesError extends Error {
  constructor() {
    super("part values are not valid JSON");
    this.name = "PartValuesError";
  }
}

export function openPartValues(
  dek: Buffer,
  correlationId: string,
  partId: number,
  s: Sealed,
): Record<string, CanonicalValue> {
  const pt = open(dek, s, valuesAad(correlationId, partId));
  let parsed: unknown;
  try {
    parsed = JSON.parse(pt.toString("utf8"));
  } catch {
    throw new PartValuesError();
  }
  return parsed as Record<string, CanonicalValue>;
}
