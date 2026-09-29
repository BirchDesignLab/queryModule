import type { IncomingMessage, Server } from "node:http";
import { STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import {
  WS_CLOSE_CODES,
  WS_PROTOCOL_VERSION,
  WsClientMessageSchema,
} from "@querymodule/core/contracts";
import { WebSocket, WebSocketServer } from "ws";
import { BACKGROUND_HEADER } from "../auth/identity";
import { trustedClientIp } from "../auth/rate-limit";
import type { AppDeps } from "../deps";
import { DEV_ORIGINS } from "../env";
import type { Principal } from "../seams";

export const WS_PATH = "/api/v1/ws";
export const WS_IDLE_MS = 60_000;
/** Upgrade attempts per client IP per window (decision D-A9, SEC-014, NFR-003). */
export const WS_UPGRADE_LIMIT = { limit: 60, windowMs: 60_000 } as const;
export const WS_LOCAL_CLOSE = { idle: 4000, badMessage: 1008, shutdown: 1001 } as const;
export interface WsHandle {
  stopAccepting(): void;
  close(): Promise<void>;
  count(): number;
}

function reject(socket: Duplex, status: number): void {
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ""}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}
function rejectLimited(socket: Duplex, retryAfterSeconds: number): void {
  socket.end(
    `HTTP/1.1 429 ${STATUS_CODES[429] ?? ""}\r\nRetry-After: ${retryAfterSeconds}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}
function toRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  // When Origin is absent and an Authorization header is present, only a signed bearer token
  // may authenticate the upgrade (carry-forward A3 T14): forwarding the cookie here would let an
  // unsigned bearer (which better-auth's requireSignature rejects outright, leaving the cookie
  // header untouched) silently authenticate through the cookie instead (I2). A cookie forwarded
  // on its own (no Authorization header at all) is unaffected: it can still resolve a session,
  // and the Origin check downstream then rejects it with 403, not 401, when Origin is absent.
  const hasOrigin = typeof req.headers.origin === "string";
  const dropCookie = !hasOrigin && typeof req.headers.authorization === "string";
  for (const [k, v] of Object.entries(req.headers)) {
    if (dropCookie && k.toLowerCase() === "cookie") continue;
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  // Marks the upgrade as background activity: it must never bump the session's idle clock
  // (spec 5.6, carry-forward A3 T15).
  headers.set(BACKGROUND_HEADER, "1");
  return new Request(`${origin}${WS_PATH}`, { headers });
}
const parse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Attaches the authenticated WebSocket upgrade and heartbeat at WS_PATH. Origin and session
 * checks reject the upgrade with an HTTP status before any socket exists (spec 5.3, 10.3); once
 * open, the socket is bound to its session and closed with 4001 on logout, expiry or revocation.
 */
export function attachWebSocket(server: Server, d: AppDeps, o: { idleMs?: number } = {}): WsHandle {
  const idleMs = o.idleMs ?? WS_IDLE_MS;
  const allowed = new Set([
    d.env.publicOrigin,
    ...(d.env.nodeEnv === "development" ? DEV_ORIGINS : []),
  ]);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  let accepting = true;

  function bind(ws: WebSocket, p: Principal): void {
    const send = (m: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };
    let idle = setTimeout(() => ws.close(WS_LOCAL_CLOSE.idle, "no ping"), idleMs);
    // The bus runs every onSessionEnded handler even when one throws (events/bus.ts), and this
    // handler is also invoked directly below to close the race with a session that ended
    // before registration completed, so it must tolerate being called more than once.
    let ended = false;
    const endSession = () => {
      if (ended) return;
      ended = true;
      ws.close(WS_CLOSE_CODES.sessionEnded, "session ended");
    };
    const offEnd = d.eventBus.onSessionEnded(p.sessionId, endSession);
    // Race (carry-forward A3 T15): the session may have ended between identity.resolve()
    // succeeding and this handler being registered, in which case onSessionEnded already ran
    // for a handler set that did not yet include this socket. Recheck once, immediately.
    d.identity.isSessionLive(p.sessionId).then(
      (live) => {
        if (!live) endSession();
      },
      (err: unknown) => {
        d.logger.error("ws session liveness recheck failed", {
          errorName: err instanceof Error ? err.name : typeof err,
        });
      },
    );
    const offSub = d.eventBus.subscribe(p.userId, send);
    ws.on("message", async (raw) => {
      const m = WsClientMessageSchema.safeParse(parse(String(raw)));
      if (!m.success) return ws.close(WS_LOCAL_CLOSE.badMessage, "bad message");
      if (m.data.type === "hello")
        return send({ v: WS_PROTOCOL_VERSION, type: "welcome", latestSeq: 0 });
      if (m.data.type === "ping") {
        let live: boolean;
        try {
          live = await d.identity.isSessionLive(p.sessionId);
        } catch (err: unknown) {
          // Fail closed (spec 5.9 security baseline, I1): a DB error mid-ping must not become
          // an unhandled rejection (ws discards this listener's returned promise).
          d.logger.error("ws ping liveness check failed", {
            errorName: err instanceof Error ? err.name : typeof err,
          });
          return endSession();
        }
        if (!live) return endSession();
        clearTimeout(idle);
        idle = setTimeout(() => ws.close(WS_LOCAL_CLOSE.idle, "no ping"), idleMs);
        return send({
          v: WS_PROTOCOL_VERSION,
          type: "pong",
          nonce: m.data.nonce,
          serverTime: d.clock.now(),
        });
      }
      // ackReceipt is accepted and ignored until M2 P1 records the metric.
    });
    ws.on("close", () => {
      clearTimeout(idle);
      offEnd();
      offSub();
    });
  }

  async function handle(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    onErr: (err: unknown) => void,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://internal");
    if (url.pathname !== WS_PATH) return reject(socket, 404);
    if (!accepting) return reject(socket, 503);
    // No token in a query string, ever (spec 4.7, 12.2).
    if (url.search !== "") return reject(socket, 400);
    // Cheapest checks first, and no session lookup until both pass (SEC-014, NFR-003): the
    // per-IP limiter (one rate_limit write), then Origin, then identity.resolve.
    const ip = trustedClientIp(
      d.env,
      typeof req.headers["cf-connecting-ip"] === "string"
        ? req.headers["cf-connecting-ip"]
        : undefined,
      () => req.socket.remoteAddress ?? "local",
    );
    const hit = await d.limiter.hit(
      `ws:ip:${ip}`,
      WS_UPGRADE_LIMIT.limit,
      WS_UPGRADE_LIMIT.windowMs,
    );
    if (!hit.allowed) return rejectLimited(socket, hit.retryAfterSeconds);
    const origin = req.headers.origin;
    const bearer = /^Bearer \S+$/.test(req.headers.authorization ?? "");
    const originOk = origin === undefined ? bearer : allowed.has(origin);
    if (!originOk) return reject(socket, 403);
    const principal = await d.identity.resolve(toRequest(req, d.env.publicOrigin));
    if (!principal) return reject(socket, 401);
    // wss.handleUpgrade attaches its own socket "error" listener once it takes over; remove
    // ours immediately beforehand (it only removes its own listener, so leaving ours attached
    // through the handshake would be harmless too, but this keeps ownership unambiguous).
    socket.off("error", onErr);
    wss.handleUpgrade(req, socket, head, (ws) => {
      bind(ws, principal);
    });
  }

  server.on("upgrade", (req, socket, head) => {
    // C1/Q1: Node removes the HTTP server's own socket-error listener before emitting
    // "upgrade", so nothing listens for "error" on this raw socket while identity.resolve()
    // (a real DB round trip) is pending below. Without this, a client that resets the TCP
    // connection during that window raises an unhandled "error" event and crashes the process,
    // unauthenticated and remotely triggerable. Left attached through every reject path; removed
    // just before wss.handleUpgrade takes over (see handle()).
    const onErr = (err: unknown) => {
      d.logger.error("ws upgrade socket error", {
        errorName: err instanceof Error ? err.name : typeof err,
      });
      socket.destroy();
    };
    socket.on("error", onErr);
    handle(req, socket, head, onErr).catch((err: unknown) => {
      d.logger.error("ws upgrade failed", {
        errorName: err instanceof Error ? err.name : typeof err,
      });
      reject(socket, 500);
    });
  });

  return {
    stopAccepting: () => {
      accepting = false;
    },
    count: () => wss.clients.size,
    close: () =>
      new Promise<void>((r) => {
        accepting = false;
        for (const c of wss.clients) c.close(WS_LOCAL_CLOSE.shutdown, "shutdown");
        wss.close(() => r());
      }),
  };
}
