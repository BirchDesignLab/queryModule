import { describe, expect, it } from "vitest";
import { WS_CLOSE_CODES, WsClientMessageSchema, WsEventSchema, WsServerMessageSchema } from "./ws";

const sourceStatus = {
  v: 1,
  type: "sourceStatus",
  seq: 7,
  at: 1790000000000,
  correlationId: "0199a0b0-0000-7000-8000-000000000001",
  partId: 0,
  sourceId: "stateSource",
  resultId: "r1",
  status: "returned",
};

describe("SEC-014 FR-043 WebSocket messages (spec 4.7)", () => {
  it("parses every client message", () => {
    for (const m of [
      { v: 1, type: "hello", lastSeq: null },
      { v: 1, type: "hello", lastSeq: 12 },
      { v: 1, type: "ping", nonce: "n1" },
      { v: 1, type: "ackReceipt", correlationId: "c1", receivedAt: 1790000000000 },
    ]) {
      expect(WsClientMessageSchema.parse(m)).toEqual(m);
    }
  });

  it("parses every server message", () => {
    for (const m of [
      { v: 1, type: "welcome", latestSeq: 12 },
      { v: 1, type: "pong", nonce: "n1", serverTime: 1790000000000 },
      sourceStatus,
    ]) {
      expect(WsServerMessageSchema.parse(m)).toEqual(m);
    }
    expect(WsEventSchema.parse(sourceStatus)).toEqual(sourceStatus);
  });

  it("rejects another protocol version and unknown types", () => {
    expect(WsClientMessageSchema.safeParse({ v: 2, type: "ping", nonce: "n" }).success).toBe(false);
    expect(WsServerMessageSchema.safeParse({ v: 1, type: "ack", correlationId: "c" }).success).toBe(
      false,
    );
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

  it("close codes match spec 4.7/5.3: 4001 on every session end, Origin is an HTTP rejection (ADR-0004)", () => {
    expect(WS_CLOSE_CODES).toEqual({ sessionEnded: 4001 });
  });
});
