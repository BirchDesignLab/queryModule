import { WS_PROTOCOL_VERSION } from "@querymodule/core/contracts";
import { parseServerMessage } from "../feed/parse-server-message.js";

export interface SocketLike {
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export type HeartbeatResult =
  | { ok: true; latestSeq: number; rttMs: number }
  | { ok: false; reason: "timeout" | "closed" | "error" | "protocol" };

export interface HeartbeatProbeOptions {
  url: string;
  createSocket(url: string): SocketLike;
  timeoutMs: number;
  now(): number;
  nonce: string;
  setTimer(fn: () => void, ms: number): () => void;
}

/** A JSON object with a string `type`: a server message, known to this client or not. */
function isTypedMessage(data: string): boolean {
  try {
    const json: unknown = JSON.parse(data);
    return (
      typeof json === "object" &&
      json !== null &&
      !Array.isArray(json) &&
      typeof (json as { type?: unknown }).type === "string"
    );
  } catch {
    return false;
  }
}

/** Opens the feed socket, sends hello, pings once and resolves on the matching pong (spec 4.7). */
export function runHeartbeatProbe(options: HeartbeatProbeOptions): Promise<HeartbeatResult> {
  return new Promise((resolve) => {
    const socket = options.createSocket(options.url);
    let settled = false;
    let latestSeq = 0;
    let pingSentAt = 0;
    let cancelTimer: () => void = () => undefined;
    const finish = (result: HeartbeatResult): void => {
      if (settled) return;
      settled = true;
      cancelTimer();
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close(1000);
      resolve(result);
    };
    cancelTimer = options.setTimer(
      () => finish({ ok: false, reason: "timeout" }),
      options.timeoutMs,
    );
    socket.onopen = () =>
      socket.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, type: "hello", lastSeq: null }));
    socket.onmessage = (event) => {
      // Tolerant receipt (ADR-0013 and its #650 amendment): a type or an enum value this client
      // does not know is skipped; a frame that is not a message, or a known type that breaks its
      // schema, fails the probe.
      let invalid = typeof event.data !== "string";
      const message = invalid
        ? null
        : parseServerMessage(event.data as string, () => {
            invalid = true;
          });
      if (invalid || (message === null && !isTypedMessage(event.data as string))) {
        finish({ ok: false, reason: "protocol" });
        return;
      }
      if (message === null) return;
      if (message.type === "welcome") {
        latestSeq = message.latestSeq;
        pingSentAt = options.now();
        socket.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, type: "ping", nonce: options.nonce }));
      } else if (message.type === "pong" && message.nonce === options.nonce) {
        finish({ ok: true, latestSeq, rttMs: options.now() - pingSentAt });
      }
    };
    socket.onclose = () => finish({ ok: false, reason: "closed" });
    socket.onerror = () => finish({ ok: false, reason: "error" });
  });
}
