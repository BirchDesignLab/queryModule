import {
  WS_CLOSE_CODES,
  WS_PING_INTERVAL_MS,
  WS_PROTOCOL_VERSION,
  type WsServerMessage,
} from "@querymodule/core/contracts";
import type { SocketLike } from "../heartbeat/heartbeat-probe.js";
import { parseServerMessage } from "./parse-server-message.js";

/** A per-source status change pushed by the server (`sourceStatus`, spec 4.7). */
export type SourceStatusEvent = Extract<WsServerMessage, { type: "sourceStatus" }>;

/** Replay was refused (spec 4.7, ADR-0013): the client refetches over HTTP; the mark is already set. */
export type ResyncEvent = Extract<WsServerMessage, { type: "resync" }>;

/** The injected timer seam, as `createConfigRefresh` takes it; tests drive it with fake timers. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/**
 * `stale` is a lost or unresponsive connection waiting to reconnect; `connecting` is a socket
 * that is opening or has not yet answered hello with welcome.
 */
export type FeedState = "closed" | "connecting" | "open" | "stale";

export interface FeedSocket {
  /**
   * Idempotent. Sends `hello { lastSeq: null }` on the session's first open and `hello { lastSeq }`
   * with the high-water mark on every reconnect (spec 4.7).
   */
  open(): void;
  /** On logout, 401 or a change of user (spec 6.7). Cancels every timer and drops the socket. */
  close(): void;
  onSourceStatus(handler: (event: SourceStatusEvent) => void): () => void;
  /** The server refused replay (`resync`): refetch over HTTP. The mark is already at `latestSeq`. */
  onResync(handler: (event: ResyncEvent) => void): () => void;
  /** A welcome after the session's first: the socket was down and is back (spec 6.8). */
  onReconnect(handler: () => void): () => void;
  /** Each backoff step while the socket is down, before the reconnect is attempted (spec 6.8). */
  onRetry(handler: () => void): () => void;
  state(): FeedState;
}

export interface FeedSocketOptions {
  createSocket: (url: string) => SocketLike;
  url: string;
  timers: Timers;
  /** Returns a number in [0, 1); the reconnect jitter and the ping nonces draw from it. */
  random: () => number;
  /** Called with the message type of a known message that failed its schema (ADR-0013 metric). */
  onInvalid?: (type: string) => void;
}

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** Two missed pongs mark the socket stale (spec 6.8). */
const MISSED_LIMIT = 2;
/** A normal closure; the browser only allows 1000 or 3000 to 4999 from a client. */
const NORMAL_CLOSURE = 1000;

/**
 * The feed socket (spec 4.7, 6.8): heartbeat, reconnect with full-jitter backoff, tolerant receipt
 * (ADR-0013) and dedup by the `seq` high-water mark. Nothing is persisted and nothing is logged:
 * no frame, field value or payload leaves this module except to its handlers.
 */
export function createFeedSocket(options: FeedSocketOptions): FeedSocket {
  const { createSocket, url, timers, random, onInvalid } = options;
  const handlers = new Set<(event: SourceStatusEvent) => void>();
  const resyncHandlers = new Set<(event: ResyncEvent) => void>();
  const reconnectHandlers = new Set<() => void>();
  const retryHandlers = new Set<() => void>();
  let state: FeedState = "closed";
  let socket: SocketLike | null = null;
  let heartbeatTimer: unknown = null;
  let retryTimer: unknown = null;
  /** Consecutive losses since the last open and first pong; the backoff exponent. */
  let losses = 0;
  /**
   * Highest seq seen; events at or below it are ignored and the next hello asks for what follows
   * it (spec 4.7). Null until the session's first welcome and again after it ends: the first open
   * replays nothing. Memory only.
   */
  let highWater: number | null = null;
  // Per connection:
  let welcomed = false;
  let missed = 0;
  let pongSeen = false;
  let pingCount = 0;
  const outstanding = new Set<string>();

  const clearHeartbeat = (): void => {
    if (heartbeatTimer !== null) timers.clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  };

  /** Detaches the current socket so nothing it does afterwards reaches this feed. */
  const detach = (): void => {
    clearHeartbeat();
    const current = socket;
    socket = null;
    if (current === null) return;
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    try {
      current.close(NORMAL_CLOSURE);
    } catch {
      // Already closed: nothing left to release.
    }
  };

  /** The connection is gone or unresponsive: drop it and reconnect after a full-jitter delay. */
  const lose = (): void => {
    detach();
    state = "stale";
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** losses);
    losses += 1;
    retryTimer = timers.setTimeout(
      () => {
        retryTimer = null;
        for (const handler of [...retryHandlers]) handler();
        // A handler may have closed the feed (a reset); only a still-stale feed reconnects.
        if (state === "stale") connect();
      },
      Math.floor(random() * ceiling),
    );
  };

  /** Close code 4001 (spec 4.7): the session ended. Stay closed until open() is called again. */
  const end = (): void => {
    detach();
    state = "closed";
    losses = 0;
    highWater = null;
  };

  const send = (message: object): boolean => {
    try {
      socket?.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, ...message }));
      return true;
    } catch {
      lose();
      return false;
    }
  };

  const scheduleHeartbeat = (): void => {
    heartbeatTimer = timers.setTimeout(heartbeat, WS_PING_INTERVAL_MS);
  };

  /**
   * Every tick: a connection that has not welcomed us, or has an unanswered ping, counts a miss;
   * `readyState` is never trusted (spec 6.8). Two misses mean stale.
   */
  function heartbeat(): void {
    heartbeatTimer = null;
    if (!welcomed || outstanding.size > 0) {
      missed += 1;
      if (missed >= MISSED_LIMIT) {
        lose();
        return;
      }
    }
    if (welcomed) {
      pingCount += 1;
      const nonce = `${Math.floor(random() * 2 ** 32).toString(36)}-${pingCount.toString(36)}`;
      outstanding.add(nonce);
      if (!send({ type: "ping", nonce })) return;
    }
    scheduleHeartbeat();
  }

  function receive(data: unknown): void {
    if (typeof data !== "string") return;
    const message = parseServerMessage(data, onInvalid);
    if (message === null) return;
    switch (message.type) {
      case "welcome": {
        // Only the session's first welcome sets the mark. On a reconnect the replay that follows
        // carries everything above it, even below latestSeq, so the mark is never lowered or
        // overwritten here (spec 4.7).
        const reconnected = highWater !== null;
        if (highWater === null) highWater = message.latestSeq;
        welcomed = true;
        missed = 0;
        state = "open";
        if (reconnected) for (const handler of [...reconnectHandlers]) handler();
        return;
      }
      case "pong":
        if (!outstanding.has(message.nonce)) return;
        outstanding.clear();
        missed = 0;
        if (!pongSeen) {
          pongSeen = true;
          losses = 0;
        }
        return;
      case "sourceStatus":
        if (message.seq <= (highWater ?? 0)) return;
        highWater = message.seq;
        for (const handler of [...handlers]) handler(message);
        return;
      case "resultHidden":
        highWater = Math.max(highWater ?? 0, message.seq);
        return;
      case "resync":
        // Replay refused (reset database, too old, too many): events after this one are live, so the
        // mark moves to the server's latest, even below the old one; the list refetch fills the gap.
        highWater = message.latestSeq;
        for (const handler of [...resyncHandlers]) handler(message);
        return;
    }
  }

  function connect(): void {
    state = "connecting";
    welcomed = false;
    missed = 0;
    pongSeen = false;
    outstanding.clear();
    let next: SocketLike;
    try {
      next = createSocket(url);
    } catch {
      lose();
      return;
    }
    socket = next;
    next.onopen = () => {
      send({ type: "hello", lastSeq: highWater });
    };
    next.onmessage = (event) => receive(event.data);
    next.onclose = (event) => {
      if (event.code === WS_CLOSE_CODES.sessionEnded) end();
      else lose();
    };
    scheduleHeartbeat();
  }

  return {
    open() {
      if (state !== "closed") return;
      connect();
    },
    close() {
      if (retryTimer !== null) timers.clearTimeout(retryTimer);
      retryTimer = null;
      end();
    },
    onSourceStatus(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    onResync(handler) {
      resyncHandlers.add(handler);
      return () => {
        resyncHandlers.delete(handler);
      };
    },
    onReconnect(handler) {
      reconnectHandlers.add(handler);
      return () => {
        reconnectHandlers.delete(handler);
      };
    },
    onRetry(handler) {
      retryHandlers.add(handler);
      return () => {
        retryHandlers.delete(handler);
      };
    },
    state: () => state,
  };
}
