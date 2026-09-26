import { z } from "zod";
import { SourceStatusSchema } from "./source-status";
import { WS_PROTOCOL_VERSION } from "./version";

const v = z.literal(WS_PROTOCOL_VERSION);
const Id = z.string().min(1);
const EpochMs = z.int().min(0);
const Seq = z.int().min(1);

export const WS_PING_INTERVAL_MS = 20_000;
/** 4001 closes the socket on every session end: logout, session expiry, session revocation, user disable (spec 4.7, 5.2, 5.3). Origin and session checks reject the upgrade with HTTP before any socket exists (401 without a live session; 403 for a foreign Origin, or a missing Origin without `Authorization: Bearer`; spec 5.3, 10.3), so they are never close codes. 4003 is unassigned; a later code is additive (master plan 8). ADR-0004. */
export const WS_CLOSE_CODES = { sessionEnded: 4001 } as const;

export const HelloMessageSchema = z.strictObject({
  v,
  type: z.literal("hello"),
  lastSeq: Seq.nullable(),
});
export const PingMessageSchema = z.strictObject({ v, type: z.literal("ping"), nonce: Id });
export const AckReceiptMessageSchema = z.strictObject({
  v,
  type: z.literal("ackReceipt"),
  correlationId: Id,
  receivedAt: EpochMs,
});

export const WelcomeMessageSchema = z.strictObject({
  v,
  type: z.literal("welcome"),
  latestSeq: z.int().min(0),
});
export const PongMessageSchema = z.strictObject({
  v,
  type: z.literal("pong"),
  nonce: Id,
  serverTime: EpochMs,
});
export const SourceStatusEventSchema = z.strictObject({
  v,
  type: z.literal("sourceStatus"),
  seq: Seq,
  at: EpochMs,
  correlationId: Id,
  partId: z.int().min(0),
  sourceId: Id,
  resultId: Id,
  status: SourceStatusSchema,
});

export const WsClientMessageSchema = z.discriminatedUnion("type", [
  HelloMessageSchema,
  PingMessageSchema,
  AckReceiptMessageSchema,
]);
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

export const WsServerMessageSchema = z.discriminatedUnion("type", [
  WelcomeMessageSchema,
  PongMessageSchema,
  SourceStatusEventSchema,
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

/** State-changing server events: carry seq, stored in event_log, pushed by EventBus.publish. */
export const WsEventSchema = z.discriminatedUnion("type", [SourceStatusEventSchema]);
export type WsEvent = z.infer<typeof WsEventSchema>;
