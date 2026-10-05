import { z } from "zod";
import { BoundedIdSchema, EpochMsSchema, PartIdSchema, Uuid7Schema } from "./primitives";
import { SourceStatusSchema } from "./source-status";
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

/** Strict on the server. Clients parse receipt tolerantly (ADR-0013): unknown types dropped, unknown keys stripped. */
export const WsServerMessageSchema = z.discriminatedUnion("type", [
  WelcomeMessageSchema,
  PongMessageSchema,
  SourceStatusEventSchema,
  ResultHiddenEventSchema,
  ResyncMessageSchema,
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

/** State-changing server events: carry seq, stored in event_log, pushed by EventBus.publish. */
export const WsEventSchema = z.discriminatedUnion("type", [
  SourceStatusEventSchema,
  ResultHiddenEventSchema,
]);
export type WsEvent = z.infer<typeof WsEventSchema>;
