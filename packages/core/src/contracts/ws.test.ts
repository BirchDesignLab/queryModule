import { describe, expect, it } from "vitest";
import {
  AckReceiptMessageSchema,
  HelloMessageSchema,
  PingMessageSchema,
  PongMessageSchema,
  RECEIPT_FALLBACK,
  RESYNC_REASONS,
  ResultHiddenEventSchema,
  ResyncMessageSchema,
  ResyncReceiptSchema,
  SourceStatusEventSchema,
  SourceStatusReceiptSchema,
  WelcomeMessageSchema,
  WS_CLOSE_CODES,
  WS_NONCE_MAX_LENGTH,
  WsClientMessageSchema,
  WsEventSchema,
  WsServerMessageSchema,
  WsServerReceiptSchema,
} from "./ws";

/** Synthetic UUIDv7 fixtures (ADR-0005). */
const CID = "0199a0b0-0000-7000-8000-000000000001";
const RID = "0199a0b0-0000-7000-8000-0000000000a1";
const RID2 = "0199a0b0-0000-7000-8000-0000000000a2";

const sourceStatus = {
  v: 1,
  type: "sourceStatus",
  seq: 7,
  at: 1790000000000,
  correlationId: CID,
  partId: 0,
  sourceId: "stateSource",
  resultId: RID,
  status: "returned",
};
const hello = { v: 1, type: "hello", lastSeq: 12 };
const ping = { v: 1, type: "ping", nonce: "n1" };
const ackReceipt = { v: 1, type: "ackReceipt", correlationId: CID, receivedAt: 1790000000000 };
const welcome = { v: 1, type: "welcome", latestSeq: 12 };
const pong = { v: 1, type: "pong", nonce: "n1", serverTime: 1790000000000 };
const resultHidden = {
  v: 1,
  type: "resultHidden",
  seq: 8,
  at: 1790000000000,
  correlationId: CID,
  resultIds: [RID, RID2],
};
const resync = { v: 1, type: "resync", reason: "tooOld", latestSeq: 40 };

describe("SEC-014 FR-043 WebSocket messages (spec 4.7)", () => {
  it("parses every client message", () => {
    for (const m of [{ ...hello, lastSeq: null }, hello, ping, ackReceipt]) {
      expect(WsClientMessageSchema.parse(m)).toEqual(m);
    }
  });

  it("parses every server message", () => {
    for (const m of [welcome, pong, sourceStatus]) {
      expect(WsServerMessageSchema.parse(m)).toEqual(m);
    }
    expect(WsEventSchema.parse(sourceStatus)).toEqual(sourceStatus);
  });

  it("rejects another protocol version and unknown types", () => {
    expect(WsClientMessageSchema.safeParse({ v: 2, type: "ping", nonce: "n" }).success).toBe(false);
    expect(WsServerMessageSchema.safeParse({ v: 1, type: "ack", correlationId: CID }).success).toBe(
      false,
    );
  });

  it("P6: the client union rejects an unknown type; the server union rejects another v", () => {
    expect(WsClientMessageSchema.safeParse({ v: 1, type: "subscribe", nonce: "n" }).success).toBe(
      false,
    );
    expect(WsClientMessageSchema.safeParse({ ...welcome }).success).toBe(false);
    expect(WsServerMessageSchema.safeParse({ ...welcome, v: 2 }).success).toBe(false);
    expect(WsServerMessageSchema.safeParse({ ...pong, v: 0 }).success).toBe(false);
  });

  it("P6: every message schema rejects unknown keys", () => {
    const cases = [
      [HelloMessageSchema, hello],
      [PingMessageSchema, ping],
      [AckReceiptMessageSchema, ackReceipt],
      [WelcomeMessageSchema, welcome],
      [PongMessageSchema, pong],
      [SourceStatusEventSchema, sourceStatus],
      [ResultHiddenEventSchema, resultHidden],
      [ResyncMessageSchema, resync],
    ] as const;
    for (const [schema, message] of cases) {
      expect(schema.safeParse(message).success).toBe(true);
      expect(schema.safeParse({ ...message, extra: 1 }).success).toBe(false);
    }
  });

  it("events are reference-only: payloads and values are rejected", () => {
    expect(
      WsServerMessageSchema.safeParse({ ...sourceStatus, payload: { status: "STOLEN" } }).success,
    ).toBe(false);
    expect(
      WsServerMessageSchema.safeParse({ ...sourceStatus, values: { plate: "ZZ-0001" } }).success,
    ).toBe(false);
  });

  it("seq starts at 1", () => {
    expect(WsEventSchema.safeParse({ ...sourceStatus, seq: 0 }).success).toBe(false);
  });

  it("M1: hello lastSeq accepts 0 (replay seq > 0) and null (replay nothing), not -1", () => {
    expect(WsClientMessageSchema.parse({ ...hello, lastSeq: 0 })).toEqual({ ...hello, lastSeq: 0 });
    expect(WsClientMessageSchema.safeParse({ ...hello, lastSeq: -1 }).success).toBe(false);
    expect(WsClientMessageSchema.safeParse({ ...hello, lastSeq: 1.5 }).success).toBe(false);
  });

  it("P2: correlationId and resultId are UUIDv7 (spec 5.5 line 854)", () => {
    expect(WsClientMessageSchema.safeParse({ ...ackReceipt, correlationId: "c1" }).success).toBe(
      false,
    );
    expect(
      WsClientMessageSchema.safeParse({ ...ackReceipt, correlationId: CID.toUpperCase() }).success,
    ).toBe(false);
    expect(WsEventSchema.safeParse({ ...sourceStatus, correlationId: "c1" }).success).toBe(false);
    expect(WsEventSchema.safeParse({ ...sourceStatus, resultId: "r1" }).success).toBe(false);
  });

  it("sourceStatus sourceId is a bounded id and partId is 0 to MAX_ALSO_RUN", () => {
    expect(WsEventSchema.safeParse({ ...sourceStatus, sourceId: "state source" }).success).toBe(
      false,
    );
    expect(WsEventSchema.safeParse({ ...sourceStatus, partId: 4 }).success).toBe(true);
    expect(WsEventSchema.safeParse({ ...sourceStatus, partId: 5 }).success).toBe(false);
  });

  it("P5: ping and pong nonces are 1 to 64 characters", () => {
    expect(WS_NONCE_MAX_LENGTH).toBe(64);
    const max = "n".repeat(WS_NONCE_MAX_LENGTH);
    expect(WsClientMessageSchema.safeParse({ ...ping, nonce: max }).success).toBe(true);
    expect(WsClientMessageSchema.safeParse({ ...ping, nonce: `${max}n` }).success).toBe(false);
    expect(WsClientMessageSchema.safeParse({ ...ping, nonce: "" }).success).toBe(false);
    expect(WsServerMessageSchema.safeParse({ ...pong, nonce: `${max}n` }).success).toBe(false);
  });

  it("close codes match spec 4.7/5.3: 4001 on every session end, Origin is an HTTP rejection (ADR-0004)", () => {
    expect(WS_CLOSE_CODES).toEqual({ sessionEnded: 4001 });
  });

  describe("FR-065 NFR-003 M2 P0 additions: resultHidden and resync (spec 4.7, ADR-0013)", () => {
    it("resultHidden with two result ids parses as a server message and as a replayable event", () => {
      expect(WsServerMessageSchema.parse(resultHidden)).toEqual(resultHidden);
      expect(WsEventSchema.parse(resultHidden)).toEqual(resultHidden);
    });

    it("resultHidden: the server union stays strict on unknown keys", () => {
      expect(WsServerMessageSchema.safeParse({ ...resultHidden, extra: 1 }).success).toBe(false);
      expect(WsEventSchema.safeParse({ ...resultHidden, extra: 1 }).success).toBe(false);
    });

    it("resultHidden carries seq from 1, UUIDv7 ids and at least one result id", () => {
      expect(WsEventSchema.safeParse({ ...resultHidden, seq: 0 }).success).toBe(false);
      expect(WsEventSchema.safeParse({ ...resultHidden, resultIds: [] }).success).toBe(false);
      expect(WsEventSchema.safeParse({ ...resultHidden, resultIds: ["r1"] }).success).toBe(false);
      expect(WsEventSchema.safeParse({ ...resultHidden, correlationId: "c1" }).success).toBe(false);
    });

    it("resync parses with each reason as a server message", () => {
      expect(RESYNC_REASONS).toEqual(["tooOld", "tooMany", "unknownCursor"]);
      for (const reason of RESYNC_REASONS) {
        const m = { ...resync, reason };
        expect(WsServerMessageSchema.parse(m)).toEqual(m);
      }
    });

    it("resync rejects an unknown reason, a negative latestSeq and a seq key; it is not an event", () => {
      expect(WsServerMessageSchema.safeParse({ ...resync, reason: "expired" }).success).toBe(false);
      expect(WsServerMessageSchema.safeParse({ ...resync, latestSeq: -1 }).success).toBe(false);
      expect(WsServerMessageSchema.parse({ ...resync, latestSeq: 0 })).toEqual({
        ...resync,
        latestSeq: 0,
      });
      expect(WsServerMessageSchema.safeParse({ ...resync, seq: 41 }).success).toBe(false);
      expect(WsEventSchema.safeParse(resync).success).toBe(false);
    });

    it("sourceStatus parsing is unchanged", () => {
      expect(WsEventSchema.parse(sourceStatus)).toEqual(sourceStatus);
      expect(WsServerMessageSchema.parse(sourceStatus)).toEqual(sourceStatus);
    });

    it("neither new message is a client message", () => {
      expect(WsClientMessageSchema.safeParse(resultHidden).success).toBe(false);
      expect(WsClientMessageSchema.safeParse(resync).success).toBe(false);
    });
  });
});

describe("#650 receipt schemas: a known type with an unknown enum value (ADR-0013 amendment)", () => {
  it("the server union stays strict: an unknown status or reason is refused", () => {
    expect(WsServerMessageSchema.safeParse({ ...sourceStatus, status: "later" }).success).toBe(
      false,
    );
    expect(WsServerMessageSchema.safeParse({ ...resync, reason: "later" }).success).toBe(false);
    expect(WsEventSchema.safeParse({ ...sourceStatus, status: "later" }).success).toBe(false);
  });

  it("receipt maps an unknown status or reason to the fallback and keeps known values", () => {
    expect(RECEIPT_FALLBACK).toBe("unknown");
    expect(SourceStatusReceiptSchema.parse({ ...sourceStatus, status: "later" })).toEqual({
      ...sourceStatus,
      status: "unknown",
    });
    expect(SourceStatusReceiptSchema.parse(sourceStatus)).toEqual(sourceStatus);
    expect(ResyncReceiptSchema.parse({ ...resync, reason: "later" })).toEqual({
      ...resync,
      reason: "unknown",
    });
    for (const reason of RESYNC_REASONS)
      expect(ResyncReceiptSchema.parse({ ...resync, reason })).toEqual({ ...resync, reason });
  });

  it("receipt still refuses a non-string, empty or overlong enum value", () => {
    for (const status of [7, null, "", "x".repeat(65)])
      expect(SourceStatusReceiptSchema.safeParse({ ...sourceStatus, status }).success).toBe(false);
    for (const reason of [7, null, "", "x".repeat(65)])
      expect(ResyncReceiptSchema.safeParse({ ...resync, reason }).success).toBe(false);
  });

  it("the receipt union carries every server message type and nothing else changes", () => {
    for (const m of [welcome, pong, sourceStatus, resultHidden, resync])
      expect(WsServerReceiptSchema.parse(m)).toEqual(m);
    expect(WsServerReceiptSchema.safeParse(hello).success).toBe(false);
  });
});
