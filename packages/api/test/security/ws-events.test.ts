import { WsServerMessageSchema } from "@querymodule/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import { WS_LOCAL_CLOSE } from "../../src/ws/server";
import { barrier, closeServers, rowsOf, setupDispatchApp } from "../helpers/ws-replay";

// Spec 5.3, 12.7 M2 row "no cross-user events" (FR-065): sourceStatus events reach
// only the owner's sockets, in event_log order, and welcome.latestSeq reads event_log.
// A latestSeq read failure, switched per test (AW4 critic 3).
const failSeq = vi.hoisted(() => ({ on: false }));
vi.mock("../../src/dispatch/event-log", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/dispatch/event-log")>();
  return {
    ...m,
    latestSeq: (...a: Parameters<typeof m.latestSeq>) =>
      failSeq.on ? Promise.reject(new Error("db down")) : m.latestSeq(...a),
  };
});
afterEach(async () => {
  failSeq.on = false;
  await closeServers();
});

async function setup() {
  const base = await setupDispatchApp();
  const statuses = (got: unknown[]) =>
    got.filter((m) => (m as { type?: string }).type === "sourceStatus");
  const hello = (ws: WebSocket, got: unknown[], lastSeq: number | null = null) => {
    const before = got.length;
    ws.send(JSON.stringify({ v: 1, type: "hello", lastSeq }));
    return vi.waitFor(() => {
      expect(got.length).toBeGreaterThan(before);
      return WsServerMessageSchema.parse(got[got.length - 1]);
    });
  };
  return { ...base, statuses, hello };
}

describe("WebSocket event delivery (spec 5.3, FR-065)", () => {
  it("delivers sourceStatus only to the owner's sockets, matching event_log", async () => {
    const c = await setup();
    const a = await c.sock(c.cookieA);
    const a2 = await c.sock(c.cookieA2);
    const b = await c.sock(c.cookieB);
    // live events are held until hello is answered (spec 5.3 replay)
    for (const x of [a, a2, b]) await c.hello(x.ws, x.got);
    await c.submit(c.cookieA, "ZZ-0001");
    await c.time.run(200);
    await vi.waitFor(() => expect(c.statuses(a.got)).toHaveLength(2));
    await vi.waitFor(() => expect(c.statuses(a2.got)).toHaveLength(2));
    const rows = await rowsOf(c.t, c.aId);
    expect(rows).toHaveLength(2);
    for (const got of [a.got, a2.got]) {
      expect(c.statuses(got)).toMatchObject(
        rows.map((r) => ({
          seq: r.seq,
          correlationId: r.correlationId,
          resultId: r.resultId,
          sourceId: r.sourceId,
          status: r.status,
        })),
      );
    }
    expect(c.statuses(b.got)).toEqual([]);
    for (const x of [a.ws, a2.ws, b.ws]) x.close();
  });

  it("sends nothing to a socket closed by logout", async () => {
    const c = await setup();
    // the server's own subscription for this socket, so the unsubscribe is seen server side
    // (AW4 critic weak test 1), not only through a client that is already closed
    const subscribe = c.t.deps.eventBus.subscribe.bind(c.t.deps.eventBus);
    const offs: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(c.t.deps.eventBus, "subscribe").mockImplementation((userId, h) => {
      const off = vi.fn(subscribe(userId, h));
      offs.push(off);
      return off;
    });
    const a = await c.sock(c.cookieA);
    expect(offs).toHaveLength(1);
    expect(offs[0]).not.toHaveBeenCalled();
    const closed = new Promise<number>((r) => a.ws.once("close", (code) => r(code)));
    await c.t.request("/api/v1/auth/sign-out", {
      method: "POST",
      headers: { cookie: c.cookieA, "x-requested-with": "querymodule" },
    });
    expect(await closed).toBe(4001);
    await vi.waitFor(() => expect(offs[0]).toHaveBeenCalledTimes(1));
    // A second session of the same user keeps working and submits.
    await c.submit(c.cookieA2, "ZZ-0001");
    await c.time.run(200);
    await vi.waitFor(() => expect(c.t.deps.dispatcher.inFlight()).toBe(0));
    expect(c.statuses(a.got)).toEqual([]);
  });

  it("welcome.latestSeq is the newest event_log seq, counting a just-committed append", async () => {
    const c = await setup();
    const first = await c.sock(c.cookieA);
    expect((await c.hello(first.ws, first.got)).type).toBe("welcome");
    expect(first.got.at(-1)).toMatchObject({ type: "welcome", latestSeq: 0 });
    await c.submit(c.cookieA, "ZZ-0001");
    await c.time.run(200);
    await vi.waitFor(() => expect(c.statuses(first.got)).toHaveLength(2));
    const fresh = await c.sock(c.cookieA2);
    await c.hello(fresh.ws, fresh.got);
    expect(fresh.got.at(-1)).toMatchObject({ type: "welcome", latestSeq: 2 });
    const other = await c.sock(c.cookieB);
    await c.hello(other.ws, other.got);
    expect(other.got.at(-1)).toMatchObject({ type: "welcome", latestSeq: 0 });
    for (const x of [first.ws, fresh.ws, other.ws]) x.close();
  });

  it("a latestSeq failure closes the socket with 1011, which the client treats as reconnect (AW4 critic 3)", async () => {
    const c = await setup();
    const a = await c.sock(c.cookieA);
    const closed = new Promise<number>((r) => a.ws.once("close", (code) => r(code)));
    failSeq.on = true;
    a.ws.send(JSON.stringify({ v: 1, type: "hello", lastSeq: null }));
    expect(await closed).toBe(WS_LOCAL_CLOSE.internal);
    expect(WS_LOCAL_CLOSE.internal).toBe(1011);
    expect(a.got).toEqual([]);
    const line = c.t.logLines.find((l) => l.includes('"msg":"ws welcome latestSeq failed"'));
    expect(line).toContain('"errorName":"Error"');
    expect(line).not.toContain("db down");
  });

  /**
   * AW4 critic weak test 2: hello arrives while T2 holds its transaction open. The read (latestSeq
   * for lastSeq null, the replay read for lastSeq 0) queues behind the DB lock, so it sees exactly
   * what T2 left: seq 1 after a commit, 0 after a rollback (and nothing is delivered).
   */
  async function helloDuringT2(commit: boolean, lastSeq: number | null) {
    const c = await setup();
    const record = c.t.deps.audit.record.bind(c.t.deps.audit);
    let reached: () => void = () => {};
    const atGate = new Promise<void>((r) => {
      reached = r;
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    c.t.deps.audit.record = async (tx, event) => {
      if (event.type === "sourceResponded") {
        reached();
        await gate;
        if (!commit) throw new Error("audit down");
      }
      return record(tx, event);
    };
    const a = await c.sock(c.cookieA);
    await c.submit(c.cookieA, "ZZ-0001", ["stateSource"]);
    await c.time.run(200);
    await atGate;
    const welcome = c.hello(a.ws, a.got, lastSeq);
    // the hello is held behind T2's lock, not answered from a stale read
    await new Promise((r) => setTimeout(r, 50));
    expect(a.got.some((m) => (m as { type?: string }).type === "welcome")).toBe(false);
    release();
    await welcome;
    const w = a.got.find((m) => (m as { type?: string }).type === "welcome");
    const rows = await rowsOf(c.t, c.aId);
    return { c, a, w, rows };
  }

  it("hello lastSeq 0 during a committing T2: welcome.latestSeq 1 and seq 1 delivered once", async () => {
    const { c, a, w, rows } = await helloDuringT2(true, 0);
    expect(w).toMatchObject({ type: "welcome", latestSeq: 1 });
    expect(rows).toHaveLength(1);
    await vi.waitFor(() => expect(c.statuses(a.got)).toHaveLength(1));
    expect(c.statuses(a.got)).toMatchObject([{ seq: 1 }]);
    // welcome first, then the row exactly once (replayed or live, never both)
    await barrier(a.ws, a.got);
    expect(
      a.got.map((m) => (m as { type?: string }).type).filter((type) => type !== "pong"),
    ).toEqual(["welcome", "sourceStatus"]);
    expect(c.t.fatals).toEqual([]);
    a.ws.close();
  });

  it("hello null during a committing T2: welcome.latestSeq 1, and seq 1 (already counted) is not sent", async () => {
    const { c, a, w, rows } = await helloDuringT2(true, null);
    expect(w).toMatchObject({ type: "welcome", latestSeq: 1 });
    expect(rows).toHaveLength(1);
    await vi.waitFor(() => expect(c.t.deps.dispatcher.inFlight()).toBe(0));
    await barrier(a.ws, a.got);
    expect(c.statuses(a.got)).toEqual([]);
    expect(c.t.fatals).toEqual([]);
    a.ws.close();
  });

  it("hello during a T2 that rolls back: welcome.latestSeq 0, no event_log row, nothing delivered", async () => {
    const { c, a, w, rows } = await helloDuringT2(false, 0);
    expect(w).toMatchObject({ type: "welcome", latestSeq: 0 });
    expect(rows).toEqual([]);
    expect(c.statuses(a.got)).toEqual([]);
    await vi.waitFor(() => expect(c.t.fatals).toHaveLength(1));
    a.ws.close();
  });
  /** A owns seq 1 and 2, B owns seq 1 to 4, all from real dispatches (seq is per user). */
  async function dispatchedForBoth() {
    const c = await setup();
    const a = await c.submit(c.cookieA, "ZZ-0001");
    const b1 = await c.submit(c.cookieB, "ZZ-0001");
    const b2 = await c.submit(c.cookieB, "ZZ-0001");
    await c.time.run(1_000);
    await vi.waitFor(() => expect(c.t.deps.dispatcher.inFlight()).toBe(0));
    const ownRows = (userId: string) => rowsOf(c.t, userId);
    return { c, a, b: [b1, b2], rowsOf: ownRows };
  }
  const idsOf = (got: unknown[], statuses: (g: unknown[]) => unknown[]) =>
    statuses(got).map((m) => (m as { correlationId: string }).correlationId);

  it("replay after a real dispatch sends each user only their own event_log rows (spec 5.3)", async () => {
    const { c, a, b, rowsOf } = await dispatchedForBoth();
    const rowsA = await rowsOf(c.aId);
    const rowsB = await rowsOf(c.bId);
    expect(rowsA.map((r) => r.seq)).toEqual([1, 2]);
    expect(rowsB.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    const sa = await c.sock(c.cookieA);
    await c.hello(sa.ws, sa.got, 0);
    const sb = await c.sock(c.cookieB);
    await c.hello(sb.ws, sb.got, 2);
    await vi.waitFor(() => expect(c.statuses(sa.got)).toHaveLength(2));
    await vi.waitFor(() => expect(c.statuses(sb.got)).toHaveLength(2));
    await barrier(sa.ws, sa.got);
    await barrier(sb.ws, sb.got);
    expect(sa.got[0]).toMatchObject({ type: "welcome", latestSeq: 2 });
    expect(sb.got[0]).toMatchObject({ type: "welcome", latestSeq: 4 });
    const pick = (r: (typeof rowsA)[number]) => ({
      seq: r.seq,
      correlationId: r.correlationId,
      resultId: r.resultId,
      sourceId: r.sourceId,
      status: r.status,
    });
    expect(c.statuses(sa.got)).toMatchObject(rowsA.map(pick));
    expect(c.statuses(sb.got)).toMatchObject(rowsB.slice(2).map(pick));
    expect(new Set(idsOf(sa.got, c.statuses))).toEqual(new Set([a.correlationId]));
    const bIds = idsOf(sb.got, c.statuses);
    expect(bIds).not.toContain(a.correlationId);
    for (const id of bIds) expect(b.map((x) => x.correlationId)).toContain(id);
    for (const x of [sa.ws, sb.ws]) x.close();
  });

  it("a lastSeq inside another user's seq range gets resync unknownCursor, never their rows (spec 5.3)", async () => {
    const { c } = await dispatchedForBoth();
    const sa = await c.sock(c.cookieA);
    // seq 3 exists for B only; A's newest is 2
    await c.hello(sa.ws, sa.got, 3);
    await vi.waitFor(() => expect(sa.got).toHaveLength(2));
    await barrier(sa.ws, sa.got);
    expect(sa.got.filter((m) => m.type !== "pong")).toMatchObject([
      { type: "welcome", latestSeq: 2 },
      { type: "resync", reason: "unknownCursor", latestSeq: 2 },
    ]);
    expect(c.statuses(sa.got)).toEqual([]);
    sa.ws.close();
  });
});
