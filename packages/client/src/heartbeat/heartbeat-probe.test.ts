import { describe, expect, it } from "vitest";
import {
  type HeartbeatProbeOptions,
  runHeartbeatProbe,
  type SocketLike,
} from "./heartbeat-probe.js";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function setup() {
  const socket = new FakeSocket();
  let clock = 1000;
  let fireTimer: () => void = () => undefined;
  const options: HeartbeatProbeOptions = {
    url: "ws://api.test/api/v1/ws",
    createSocket: () => socket,
    timeoutMs: 5000,
    now: () => clock,
    nonce: "nonce-1",
    setTimer: (fn) => {
      fireTimer = fn;
      return () => {
        fireTimer = () => undefined;
      };
    },
  };
  return {
    socket,
    options,
    advance: (ms: number) => {
      clock += ms;
    },
    fire: () => fireTimer(),
  };
}

describe("NFR-003 heartbeat probe (spec 4.7, 5.3, 6.8)", () => {
  it("hello, welcome, ping, pong resolves with round-trip time and closes", async () => {
    const t = setup();
    const result = runHeartbeatProbe(t.options);
    t.socket.onopen?.();
    expect(JSON.parse(t.socket.sent[0] ?? "")).toEqual({ v: 1, type: "hello", lastSeq: null });
    t.socket.receive({ v: 1, type: "welcome", latestSeq: 7 });
    expect(JSON.parse(t.socket.sent[1] ?? "")).toEqual({ v: 1, type: "ping", nonce: "nonce-1" });
    t.advance(42);
    t.socket.receive({ v: 1, type: "pong", nonce: "other", serverTime: 1 });
    t.socket.receive({ v: 1, type: "pong", nonce: "nonce-1", serverTime: 1 });
    expect(await result).toEqual({ ok: true, latestSeq: 7, rttMs: 42 });
    expect(t.socket.closed).toBe(true);
  });
  it("times out", async () => {
    const t = setup();
    const result = runHeartbeatProbe(t.options);
    t.fire();
    expect(await result).toEqual({ ok: false, reason: "timeout" });
  });
  it("reports a close before pong", async () => {
    const t = setup();
    const result = runHeartbeatProbe(t.options);
    t.socket.onclose?.();
    expect(await result).toEqual({ ok: false, reason: "closed" });
  });
  it("reports a socket error", async () => {
    const t = setup();
    const result = runHeartbeatProbe(t.options);
    t.socket.onerror?.();
    expect(await result).toEqual({ ok: false, reason: "error" });
  });
  it("ignores a message type or a status it does not know before the pong (ADR-0013, #650)", async () => {
    const t = setup();
    const result = runHeartbeatProbe(t.options);
    t.socket.onopen?.();
    t.socket.receive({ v: 1, type: "welcome", latestSeq: 7 });
    t.socket.receive({ v: 1, type: "somethingNew", seq: 8 });
    t.socket.receive({
      v: 1,
      type: "sourceStatus",
      seq: 8,
      at: 1,
      correlationId: "01923abc-4def-7123-8abc-0123456789ab",
      partId: 0,
      sourceId: "state",
      resultId: "01923abc-4def-7123-8abc-0123456789ac",
      status: "someLaterStatus",
    });
    t.advance(5);
    t.socket.receive({ v: 1, type: "pong", nonce: "nonce-1", serverTime: 1 });
    expect(await result).toEqual({ ok: true, latestSeq: 7, rttMs: 5 });
  });
  it("still fails a known type that breaks its schema as protocol", async () => {
    const t = setup();
    const result = runHeartbeatProbe(t.options);
    t.socket.onopen?.();
    t.socket.receive({ v: 1, type: "welcome", latestSeq: -1 });
    expect(await result).toEqual({ ok: false, reason: "protocol" });
  });
  it("fails a binary frame and a JSON object with no type as protocol", async () => {
    const binary = setup();
    const first = runHeartbeatProbe(binary.options);
    binary.socket.onmessage?.({ data: new ArrayBuffer(4) });
    expect(await first).toEqual({ ok: false, reason: "protocol" });
    const typeless = setup();
    const second = runHeartbeatProbe(typeless.options);
    typeless.socket.receive({ v: 1, latestSeq: 7 });
    expect(await second).toEqual({ ok: false, reason: "protocol" });
  });
  it("rejects messages that fail the WS schema", async () => {
    const t = setup();
    const result = runHeartbeatProbe(t.options);
    t.socket.onmessage?.({ data: "not json" });
    expect(await result).toEqual({ ok: false, reason: "protocol" });
  });
});
