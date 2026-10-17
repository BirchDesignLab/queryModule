import { z } from "zod";
import { BoundedIdSchema, EpochMsSchema, PartIdSchema, Uuid7Schema } from "./primitives";
import { SOURCE_STATUSES, SourceStatusSchema } from "./source-status";
import { WS_PROTOCOL_VERSION } from "./version";

const v = z.literal(WS_PROTOCOL_VERSION);
const Seq = z.int().min(1);
/** Ping nonce cap: the server validates client input, so the bound is set before the freeze. */
export const WS_NONCE_MAX_LENGTH = 64;
const Nonce = z.string().min(1).max(WS_NONCE_MAX_LENGTH);

export const WS_PING_INTERVAL_MS = 20_000;
/** 4001 closes the socket on every session end: logout, session expiry, session revocation, user disable (spec 4.7, 5.2, 5.3). Origin and session checks reject the upgrade with HTTP before any socket exists (401 without a live session; 403 for a foreign Origin, or a missing Origin without `Authorization: Bearer`; spec 5.3, 10.3), so they are never close codes. 4003 is unassigned; a later code is additive (master plan 8). ADR-0004. */
export const WS_CLOSE_CODES = { sessionEnded: 4001 } as const;

export const HelloMessageSchema = z.strictObject({
  v,
  type: z.literal("hello"),
  /** Replay sends seq > lastSeq, so 0 replays everything within the caps; null replays nothing (spec 4.7). */
  lastSeq: z.int().min(0).nullable(),
});
export const PingMessageSchema = z.strictObject({ v, type: z.literal("ping"), nonce: Nonce });
export const AckReceiptMessageSchema = z.strictObject({
  v,
  type: z.literal("ackReceipt"),
  correlationId: Uuid7Schema,
  receivedAt: EpochMsSchema,
});

export const WelcomeMessageSchema = z.strictObject({
  v,
  type: z.literal("welcome"),
  latestSeq: z.int().min(0),
});
export const PongMessageSchema = z.strictObject({
  v,
  type: z.literal("pong"),
  nonce: Nonce,
  serverTime: EpochMsSchema,
});
export const SourceStatusEventSchema = z.strictObject({
  v,
  type: z.literal("sourceStatus"),
  seq: Seq,
  at: EpochMsSchema,
  correlationId: Uuid7Schema,
  partId: PartIdSchema,
  sourceId: BoundedIdSchema,
  resultId: Uuid7Schema,
  status: SourceStatusSchema,
});
/** Delete from view (spec 4.7, 5.5): pushed after the hide commits so the owner's other devices drop the results. Carries seq, so it is replayable. */
export const ResultHiddenEventSchema = z.strictObject({
  v,
  type: z.literal("resultHidden"),
  seq: Seq,
  at: EpochMsSchema,
  correlationId: Uuid7Schema,
  resultIds: z.array(Uuid7Schema).min(1),
});
/** Why replay was refused (spec 4.7, 5.5): cursor older than 24 h, more than 500 events due, or a cursor the server does not know. */
export const RESYNC_REASONS = ["tooOld", "tooMany", "unknownCursor"] as const;
/** Replay refused: the client refetches over HTTP and sets its high-water mark to latestSeq. Not an event (no seq, never stored). */
export const ResyncMessageSchema = z.strictObject({
  v,
  type: z.literal("resync"),
  reason: z.enum(RESYNC_REASONS),
  latestSeq: z.int().min(0),
});

export const WsClientMessageSchema = z.discriminatedUnion("type", [
  HelloMessageSchema,
  PingMessageSchema,
  AckReceiptMessageSchema,
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

/** Strict on the server. Clients parse receipt tolerantly (ADR-0013): unknown types dropped, unknown keys stripped, unknown enum values read through WsServerReceiptSchema (#650). */
export const WsServerMessageSchema = z.discriminatedUnion("type", [
  WelcomeMessageSchema,
  PongMessageSchema,
  SourceStatusEventSchema,
  ResultHiddenEventSchema,
  ResyncMessageSchema,
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

/**
 * What a client shows for an enum value it does not know (#650, ADR-0013 amendment): a neutral
 * "unknown" status, and a resync it still acts on (it refetches whatever the reason).
 */
export const RECEIPT_FALLBACK = "unknown" as const;
/** An enum value a newer server may send: a bounded, non-empty string, never another type. */
export const WS_ENUM_MAX_LENGTH = 64;

/** A known value, or a bounded string a later server added, read as the fallback (#650). */
function tolerantEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.union([
    z.enum(values),
    z
      .string()
      .min(1)
      .max(WS_ENUM_MAX_LENGTH)
      .transform((): typeof RECEIPT_FALLBACK => RECEIPT_FALLBACK),
  ]);
}

/**
 * Client receipt of sourceStatus (ADR-0013 amendment, #650): an unknown status is kept as
 * "unknown" instead of dropping the message. The server never sends this shape.
 */
export const SourceStatusReceiptSchema = SourceStatusEventSchema.extend({
  status: tolerantEnum(SOURCE_STATUSES),
});
/** Client receipt of resync (#650): an unknown reason is kept as "unknown"; the refetch runs. */
export const ResyncReceiptSchema = ResyncMessageSchema.extend({
  reason: tolerantEnum(RESYNC_REASONS),
});

/**
 * The server union as clients receive it (ADR-0013 and its #650 amendment): the server's strict
 * schemas, except that sourceStatus and resync read an unknown enum value as RECEIPT_FALLBACK.
 */
export const WsServerReceiptSchema = z.discriminatedUnion("type", [
  WelcomeMessageSchema,
  PongMessageSchema,
  SourceStatusReceiptSchema,
  ResultHiddenEventSchema,
  ResyncReceiptSchema,
]);
export type WsServerReceipt = z.infer<typeof WsServerReceiptSchema>;

/** State-changing server events: carry seq, stored in event_log, pushed by EventBus.publish. */
export const WsEventSchema = z.discriminatedUnion("type", [
  SourceStatusEventSchema,
  ResultHiddenEventSchema,
]);
export type WsEvent = z.infer<typeof WsEventSchema>;
