import { randomBytes } from "node:crypto";
import { Uuid7Schema } from "@querymodule/core/contracts";
import type { CanonicalValue } from "@querymodule/core/rules";
import { open, type Sealed, seal } from "./aead";
import { CURRENT_KEY_VERSION } from "./canary";

/** Spec 5.5 request_key: one DEK per scope, wrapped directly under DATA_KEY (SEC-006, SEC-021). */
export const REQUEST_KEY_SCOPES = ["values", "payload"] as const;
export type RequestKeyScope = (typeof REQUEST_KEY_SCOPES)[number];
/**
 * The DATA_KEY version (the data key canary's) that wraps new rows, so a rotation can tell
 * which DATA_KEY wrapped a row from its key_version (#311).
 */
export const REQUEST_KEY_VERSION = CURRENT_KEY_VERSION;
const DEK_BYTES = 32;

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

const REQUEST_KEY_ERROR_MESSAGES = {
  dekLength: "unwrapped request key has the wrong length",
  id: "request key AAD id is not a UUIDv7",
  scope: "request key scope is not known",
  keyVersion: "request key version is not a positive integer",
  partId: "part id is not a non-negative integer",
  nonFinite: "part values hold a non-finite number",
} as const;
export type RequestKeyErrorReason = keyof typeof REQUEST_KEY_ERROR_MESSAGES;

/** Fixed messages: never carries an id, a value or key bytes (spec 5.9). */
export class RequestKeyError extends Error {
  constructor(readonly reason: RequestKeyErrorReason) {
    super(REQUEST_KEY_ERROR_MESSAGES[reason]);
    this.name = "RequestKeyError";
  }
}

/**
 * AAD fields are validated before use: ids are canonical UUIDv7 (hex and "-") and numbers are
 * integers, so no field can hold the "|" separator and two AADs cannot collide (#311).
 */
function uuid7(id: string): string {
  if (!Uuid7Schema.safeParse(id).success) throw new RequestKeyError("id");
  return id;
}
function partIdOf(partId: number): number {
  if (!Number.isSafeInteger(partId) || partId < 0) throw new RequestKeyError("partId");
  return partId;
}

export function requestKeyAad(correlationId: string, scope: RequestKeyScope, keyVersion: number) {
  uuid7(correlationId);
  if (!REQUEST_KEY_SCOPES.includes(scope)) throw new RequestKeyError("scope");
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new RequestKeyError("keyVersion");
  return `request_key|${correlationId}|${scope}|${keyVersion}`;
}
export const valuesAad = (correlationId: string, partId: number) =>
  `query_request|${uuid7(correlationId)}|${partIdOf(partId)}|values`;
/** Used by the M1 P3 dispatcher. */
export const payloadAad = (resultId: string) => `source_result|${uuid7(resultId)}|payload`;

export function createRequestKeys(
  dataKey: Buffer,
  correlationId: string,
  now: number,
): { rows: RequestKeyRow[]; deks: RequestDeks } {
  uuid7(correlationId);
  const deks: RequestDeks = { values: randomBytes(DEK_BYTES), payload: randomBytes(DEK_BYTES) };
  try {
    const rows = REQUEST_KEY_SCOPES.map((scope): RequestKeyRow => {
      const s = seal(
        dataKey,
        deks[scope],
        requestKeyAad(correlationId, scope, REQUEST_KEY_VERSION),
      );
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
  } catch (e) {
    deks.values.fill(0);
    deks.payload.fill(0);
    throw e;
  }
}

/**
 * AeadError on a wrong key or a row moved to another request, scope or version;
 * RequestKeyError("dekLength") when the unwrapped DEK is not 32 bytes (zeroed first).
 */
export function unwrapRequestKey(dataKey: Buffer, row: RequestKeyRow): Buffer {
  const dek = open(
    dataKey,
    { ciphertext: row.wrappedDek, iv: row.iv, tag: row.authTag },
    requestKeyAad(row.correlationId, row.scope, row.keyVersion),
  );
  if (dek.length !== DEK_BYTES) {
    dek.fill(0);
    throw new RequestKeyError("dekLength");
  }
  return dek;
}

export function sealPartValues(
  dek: Buffer,
  correlationId: string,
  partId: number,
  values: Readonly<Record<string, CanonicalValue>>,
): Sealed {
  const aad = valuesAad(correlationId, partId);
  const entries = Object.entries(values).sort(([a], [b]) => (a < b ? -1 : 1));
  // JSON.stringify turns NaN and Infinity into null; refuse them instead (#311).
  if (entries.some(([, v]) => typeof v === "number" && !Number.isFinite(v))) {
    throw new RequestKeyError("nonFinite");
  }
  const plaintext = Buffer.from(JSON.stringify(Object.fromEntries(entries)), "utf8");
  try {
    return seal(dek, plaintext, aad);
  } finally {
    plaintext.fill(0);
  }
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
  } finally {
    pt.fill(0);
  }
  return parsed as Record<string, CanonicalValue>;
}
