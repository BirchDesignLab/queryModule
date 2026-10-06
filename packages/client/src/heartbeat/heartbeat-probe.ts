import { WS_PROTOCOL_VERSION, WsServerMessageSchema } from "@querymodule/core/contracts";

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

function parseJson(data: unknown): unknown {
  if (typeof data !== "string") return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
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
      const parsed = WsServerMessageSchema.safeParse(parseJson(event.data));
      if (!parsed.success) {
        finish({ ok: false, reason: "protocol" });
        return;
      }
      const message = parsed.data;
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
