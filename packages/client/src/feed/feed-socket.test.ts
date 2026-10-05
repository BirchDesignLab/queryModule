import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket } from "../testing/fake-socket.js";
import { createFeedSocket, type FeedSocket, type SourceStatusEvent } from "./feed-socket.js";

const URL = "ws://api.test/api/v1/ws";
const PING_MS = 20_000;
const CORRELATION_ID = "01923abc-4def-7123-8abc-0123456789ab";
const RESULT_ID = "01923abc-4def-7123-8abc-0123456789ac";

function sourceStatus(seq: number, extra: Record<string, unknown> = {}) {
  return {
    v: 1,
    type: "sourceStatus",
    seq,
    at: 1_700_000_000_000 + seq,
    correlationId: CORRELATION_ID,
    partId: 0,
    sourceId: "state",
    resultId: RESULT_ID,
    status: "returned",
    ...extra,
  };
}

function setup(random: () => number = () => 0.5) {
  const sockets: FakeSocket[] = [];
  const onInvalid = vi.fn();
  const feed: FeedSocket = createFeedSocket({
    url: URL,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    timers: {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (id) => globalThis.clearTimeout(id as number),
    },
    random,
    onInvalid,
  });
  const events: SourceStatusEvent[] = [];
  feed.onSourceStatus((e) => events.push(e));
  /** Opens the latest socket and answers its hello with a welcome. */
  const connect = (latestSeq = 0): FakeSocket => {
    const socket = sockets.at(-1) as FakeSocket;
    socket.open();
    socket.receive({ v: 1, type: "welcome", latestSeq });
    return socket;
  };
  /** Answers the most recent ping with a matching pong. */
  const pong = (socket: FakeSocket): void => {
    const ping = socket
      .sentMessages()
      .reverse()
      .find((m) => m.type === "ping");
    socket.receive({ v: 1, type: "pong", nonce: ping?.nonce, serverTime: 1 });
  };
  return { feed, sockets, events, onInvalid, connect, pong };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("FR-065 feed socket: connect and dedup (spec 4.7, ADR-0013)", () => {
  it("open() connects once and sends hello with a null cursor", () => {
    const t = setup();
    expect(t.feed.state()).toBe("closed");
    t.feed.open();
    t.feed.open();
    expect(t.sockets).toHaveLength(1);
    expect(t.sockets[0]?.url).toBe(URL);
    expect(t.feed.state()).toBe("connecting");
    t.sockets[0]?.open();
    expect(t.sockets[0]?.sentMessages()).toEqual([{ v: 1, type: "hello", lastSeq: null }]);
    expect(t.feed.state()).toBe("connecting");
    t.sockets[0]?.receive({ v: 1, type: "welcome", latestSeq: 0 });
    expect(t.feed.state()).toBe("open");
  });

  it("ignores seq at or below the welcome mark and delivers each later seq once", () => {
    const t = setup();
    t.feed.open();
    const socket = t.connect(5);
    socket.receive(sourceStatus(5));
    expect(t.events).toHaveLength(0);
    socket.receive(sourceStatus(6));
    socket.receive(sourceStatus(6));
    socket.receive(sourceStatus(4));
    expect(t.events.map((e) => e.seq)).toEqual([6]);
    socket.receive(sourceStatus(7));
    expect(t.events.map((e) => e.seq)).toEqual([6, 7]);
  });

  it("an event that beats the welcome is delivered and moves the mark", () => {
    const t = setup();
    t.feed.open();
    const socket = t.sockets[0] as FakeSocket;
    socket.open();
    socket.receive(sourceStatus(3));
    socket.receive(sourceStatus(3));
    expect(t.events.map((e) => e.seq)).toEqual([3]);
  });

  it("a resultHidden event advances the mark and is not delivered as a status", () => {
    const t = setup();
    t.feed.open();
    const socket = t.connect(0);
    socket.receive({
      v: 1,
      type: "resultHidden",
      seq: 1,
      at: 1,
      correlationId: CORRELATION_ID,
      resultIds: [RESULT_ID],
    });
    socket.receive(sourceStatus(1));
    expect(t.events).toHaveLength(0);
    socket.receive(sourceStatus(2));
    expect(t.events.map((e) => e.seq)).toEqual([2]);
  });

  it("an unknown type does not throw and an extra key is stripped", () => {
    const t = setup();
    t.feed.open();
    const socket = t.connect(0);
    expect(() => socket.receive({ v: 1, type: "somethingNew", seq: 9 })).not.toThrow();
    socket.receive(sourceStatus(1, { surprise: "x" }));
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).not.toHaveProperty("surprise");
    expect(t.onInvalid).not.toHaveBeenCalled();
  });

  it("a known type that fails its schema is dropped, counted by type, and keeps the socket", () => {
    const t = setup();
    t.feed.open();
    const socket = t.connect(0);
    socket.receive(sourceStatus(1, { status: "notAStatus" }));
    expect(t.events).toHaveLength(0);
    expect(t.onInvalid).toHaveBeenCalledExactlyOnceWith("sourceStatus");
    expect(socket.closed).toBe(false);
    expect(t.feed.state()).toBe("open");
  });

  it("ignores binary frames and malformed json", () => {
    const t = setup();
    t.feed.open();
    const socket = t.connect(0);
    socket.receiveRaw(new ArrayBuffer(4));
    socket.receiveRaw("{nope");
    expect(t.events).toHaveLength(0);
    expect(t.feed.state()).toBe("open");
  });

  it("onSourceStatus returns an unsubscribe", () => {
    const t = setup();
    const seen: number[] = [];
    const off = t.feed.onSourceStatus((e) => seen.push(e.seq));
    t.feed.open();
    const socket = t.connect(0);
    socket.receive(sourceStatus(1));
    off();
    socket.receive(sourceStatus(2));
    expect(seen).toEqual([1]);
  });
});

describe("FR-065 feed socket: heartbeat (spec 6.8)", () => {
  it("pings every 20 s with a fresh nonce and stays open while pongs arrive", () => {
    const t = setup();
    t.feed.open();
    const socket = t.connect(0);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(PING_MS);
      t.pong(socket);
    }
    const pings = socket.sentMessages().filter((m) => m.type === "ping");
    expect(pings).toHaveLength(5);
    expect(new Set(pings.map((p) => p.nonce)).size).toBe(5);
    expect(t.feed.state()).toBe("open");
    expect(socket.closed).toBe(false);
  });

  it("a pong with an unknown nonce does not count", () => {
    const t = setup();
    t.feed.open();
    const socket = t.connect(0);
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(PING_MS);
      socket.receive({ v: 1, type: "pong", nonce: "not-ours", serverTime: 1 });
    }
    vi.advanceTimersByTime(PING_MS);
    expect(t.feed.state()).toBe("stale");
  });

  it("two missed pongs mark it stale, close it, and reconnect after a jittered delay", () => {
    const t = setup(() => 0.5);
    t.feed.open();
    const first = t.connect(0);
    vi.advanceTimersByTime(PING_MS);
    expect(first.sentMessages().filter((m) => m.type === "ping")).toHaveLength(1);
    vi.advanceTimersByTime(PING_MS);
    expect(t.feed.state()).toBe("open");
    vi.advanceTimersByTime(PING_MS);
    expect(t.feed.state()).toBe("stale");
    expect(first.closed).toBe(true);
    expect(t.sockets).toHaveLength(1);
    vi.advanceTimersByTime(499);
    expect(t.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.sockets).toHaveLength(2);
    expect(t.feed.state()).toBe("connecting");
  });

  it("readyState is never trusted: a socket that opened but never welcomed goes stale", () => {
    const t = setup();
    t.feed.open();
    t.sockets[0]?.open();
    vi.advanceTimersByTime(PING_MS * 2);
    expect(t.feed.state()).toBe("stale");
    expect(t.sockets[0]?.closed).toBe(true);
  });

  it("a connect that never opens goes stale and retries", () => {
    const t = setup();
    t.feed.open();
    vi.advanceTimersByTime(PING_MS * 2);
    expect(t.feed.state()).toBe("stale");
    vi.advanceTimersByTime(1000);
    expect(t.sockets).toHaveLength(2);
  });
});

describe("FR-065 feed socket: reconnect (spec 6.8)", () => {
  it("backs off 1 s, 2 s, 4 s up to 30 s with full jitter", () => {
    const t = setup(() => 0.5);
    t.feed.open();
    const expected = [500, 1000, 2000, 4000, 8000, 15_000, 15_000];
    for (const [i, delay] of expected.entries()) {
      const socket = t.sockets.at(-1) as FakeSocket;
      socket.serverClose(1006);
      expect(t.feed.state()).toBe("stale");
      vi.advanceTimersByTime(delay - 1);
      expect(t.sockets).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(t.sockets).toHaveLength(i + 2);
    }
  });

  it("the first two delays fall in [0, 1 s] then [0, 2 s]", () => {
    for (const r of [0, 0.999999]) {
      const t = setup(() => r);
      t.feed.open();
      (t.sockets.at(-1) as FakeSocket).serverClose();
      vi.advanceTimersByTime(1000);
      expect(t.sockets).toHaveLength(2);
      (t.sockets.at(-1) as FakeSocket).serverClose();
      vi.advanceTimersByTime(2000);
      expect(t.sockets).toHaveLength(3);
      t.feed.close();
    }
  });

  it("resets the backoff after an open and the first pong, not after the open alone", () => {
    const t = setup(() => 0.5);
    t.feed.open();
    (t.sockets.at(-1) as FakeSocket).serverClose();
    vi.advanceTimersByTime(500);
    // Second attempt opens and welcomes but never answers a ping: backoff keeps growing.
    const second = t.connect(0);
    second.serverClose();
    vi.advanceTimersByTime(999);
    expect(t.sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(t.sockets).toHaveLength(3);
    // Third attempt gets its first pong: the next loss backs off from 1 s again.
    const third = t.connect(0);
    vi.advanceTimersByTime(PING_MS);
    t.pong(third);
    third.serverClose();
    vi.advanceTimersByTime(499);
    expect(t.sockets).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(t.sockets).toHaveLength(4);
  });

  it("each reconnect says hello with a null cursor and restarts the mark at the new welcome", () => {
    const t = setup();
    t.feed.open();
    const first = t.connect(0);
    first.receive(sourceStatus(10));
    first.serverClose();
    vi.advanceTimersByTime(1000);
    const second = t.connect(12);
    expect(second.sentMessages()[0]).toEqual({ v: 1, type: "hello", lastSeq: null });
    second.receive(sourceStatus(11));
    second.receive(sourceStatus(13));
    expect(t.events.map((e) => e.seq)).toEqual([10, 13]);
  });

  it("close code 4001 does not reconnect", () => {
    const t = setup();
    t.feed.open();
    const socket = t.connect(0);
    socket.serverClose(4001);
    expect(t.feed.state()).toBe("closed");
    vi.advanceTimersByTime(120_000);
    expect(t.sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("open() works again after a 4001 (a new session)", () => {
    const t = setup();
    t.feed.open();
    t.connect(0).serverClose(4001);
    t.feed.open();
    expect(t.sockets).toHaveLength(2);
    expect(t.feed.state()).toBe("connecting");
  });

  it("a send that throws counts as a lost connection", () => {
    const t = setup();
    t.feed.open();
    const socket = t.sockets[0] as FakeSocket;
    socket.throwOnSend = true;
    socket.open();
    expect(t.feed.state()).toBe("stale");
    vi.advanceTimersByTime(1000);
    expect(t.sockets).toHaveLength(2);
  });

  it("a late close from a socket already replaced is ignored", () => {
    const t = setup();
    t.feed.open();
    const first = t.sockets[0] as FakeSocket;
    vi.advanceTimersByTime(PING_MS * 2);
    vi.advanceTimersByTime(1000);
    expect(t.sockets).toHaveLength(2);
    first.serverClose(4001);
    expect(t.feed.state()).toBe("connecting");
    first.receive(sourceStatus(1));
    expect(t.events).toHaveLength(0);
  });
});

describe("SEC-006 feed socket: close() leaves nothing behind (spec 6.7)", () => {
  it("close() closes the socket, cancels every timer and drops late frames", () => {
    const t = setup();
    t.feed.open();
    const socket = t.connect(0);
    vi.advanceTimersByTime(PING_MS);
    t.feed.close();
    expect(t.feed.state()).toBe("closed");
    expect(socket.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    socket.receive(sourceStatus(1));
    socket.serverClose(1006);
    expect(t.events).toHaveLength(0);
    vi.advanceTimersByTime(120_000);
    expect(t.sockets).toHaveLength(1);
  });

  it("close() during the backoff wait cancels the pending reconnect", () => {
    const t = setup();
    t.feed.open();
    t.connect(0).serverClose();
    expect(vi.getTimerCount()).toBe(1);
    t.feed.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(t.sockets).toHaveLength(1);
  });

  it("close() while connecting closes the half-open socket", () => {
    const t = setup();
    t.feed.open();
    t.feed.close();
    expect(t.sockets[0]?.closed).toBe(true);
    t.sockets[0]?.open();
    expect(t.sockets[0]?.sent).toHaveLength(0);
  });

  it("close() is idempotent and the feed can open again with a fresh mark", () => {
    const t = setup();
    t.feed.open();
    t.connect(0).receive(sourceStatus(8));
    t.feed.close();
    t.feed.close();
    t.feed.open();
    const second = t.connect(0);
    second.receive(sourceStatus(8));
    expect(t.events.map((e) => e.seq)).toEqual([8, 8]);
    expect(t.sockets).toHaveLength(2);
  });

  it("logs nothing, even for malformed frames and lost connections", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const t = setup();
    t.feed.open();
    const socket = t.connect(0);
    socket.receiveRaw("{nope");
    socket.receive(sourceStatus(1, { status: "notAStatus" }));
    socket.serverClose(1006);
    t.feed.close();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });
});
