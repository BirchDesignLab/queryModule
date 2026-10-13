import { afterEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../src/db/tx";
import {
  appendEvent,
  EVENT_LOG_RETENTION_MS,
  pruneEventLog,
  REPLAY_MAX_EVENTS,
  type SourceStatusEvent,
} from "../../src/dispatch/event-log";
import { uuidv7 } from "../../src/ids";
import { WS_LOCAL_CLOSE } from "../../src/ws/server";
import { createTestClock } from "../helpers/fixture";
import { createTestApp, startTestServer, type TestApp } from "../helpers/test-app";
import { barrier, ORIGIN, openSocket, PW, sendHello } from "../helpers/ws-replay";

// Spec 5.3 replay (FR-043, FR-065, NFR-003, SEC-014; spec 4.7, 6.8; ADR-0013): hello { lastSeq }
// gets welcome, then the owner's missed event_log rows in seq order or one resync, then live events.
// Each test switches the replay read per test: a forced failure, or a hook that runs before it.
const replayHook = vi.hoisted(() => ({
  fail: false,
  before: null as null | (() => Promise<void>),
  after: null as null | (() => void | Promise<void>),
}));
vi.mock("../../src/dispatch/event-log", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/dispatch/event-log")>();
  return {
    ...m,
    eventsSince: async (...a: Parameters<typeof m.eventsSince>) => {
      if (replayHook.fail) throw new Error("db down");
      if (replayHook.before) await replayHook.before();
      const r = await m.eventsSince(...a);
      // awaited, so a publish the hook makes lands while the server still holds live events
      await replayHook.after?.();
      return r;
    },
  };
});
const DAY = EVENT_LOG_RETENTION_MS;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  replayHook.fail = false;
  replayHook.before = null;
  replayHook.after = null;
  for (const c of closers.splice(0)) await c();
});

type Msg = {
  type: string;
  seq?: number;
  reason?: string;
  latestSeq?: number;
  correlationId?: string;
};

/** One appended row per call, in the caller's transaction, as the dispatcher writes them. */
async function append(t: TestApp, userId: string, n: number, at: number) {
  return withTransaction(t.deps.db, async (tx) => {
    const out: SourceStatusEvent[] = [];
    for (let i = 0; i < n; i += 1) {
      out.push(
        await appendEvent(tx, {
          userId,
          type: "sourceStatus",
          correlationId: uuidv7(at),
          partId: 0,
          sourceId: "stateSource",
          resultId: uuidv7(at),
          status: "returned",
          createdAt: at,
        }),
      );
    }
    return out;
  });
}

async function setup() {
  const clock = createTestClock();
  const t = await createTestApp({ clock });
  const aId = await t.createUser("a@example.test", PW);
  const bId = await t.createUser("b@example.test", PW);
  const cookieA = await t.cookieFor("a@example.test", PW);
  const cookieB = await t.cookieFor("b@example.test", PW);
  const s = await startTestServer(t);
  closers.push(s.close);
  const sock = (cookie: string) => openSocket<Msg>(s.wsUrl, { origin: ORIGIN, cookie });
  /** Appends one row and publishes it after the commit, as the outcome writer does. */
  const live = async (userId: string) => {
    const [e] = await append(t, userId, 1, clock.now());
    t.deps.eventBus.publish(userId, e as SourceStatusEvent);
    return e as SourceStatusEvent;
  };
  const hello = sendHello;
  const shape = (got: Msg[]) =>
    got
      .filter((m) => m.type !== "pong")
      .map((m) =>
        m.type === "sourceStatus"
          ? m.seq
          : m.type === "resync"
            ? `resync:${m.reason}:${m.latestSeq}`
            : `${m.type}:${m.latestSeq}`,
      );
  return { t, clock, aId, bId, cookieA, cookieB, sock, live, hello, barrier, shape };
}

describe("replay by lastSeq (spec 5.3, FR-043, FR-065, SEC-014)", () => {
  it("lastSeq 2 of 5 gets welcome, seq 3, 4, 5 in order, then a live 6", async () => {
    const c = await setup();
    const rows = await append(c.t, c.aId, 5, c.clock.now());
    const a = await c.sock(c.cookieA);
    c.hello(a.ws, 2);
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:5", 3, 4, 5]);
    // replayed rows are the stored ones, re-validated, ids and status only
    expect(a.got.filter((m) => m.type === "sourceStatus")).toEqual(rows.slice(2));
    await c.live(c.aId);
    await vi.waitFor(() => expect(c.shape(a.got)).toEqual(["welcome:5", 3, 4, 5, 6]));
    a.ws.close();
  });

  it("lastSeq above latestSeq gets resync unknownCursor with latestSeq, then live events flow", async () => {
    const c = await setup();
    await append(c.t, c.aId, 5, c.clock.now());
    const a = await c.sock(c.cookieA);
    c.hello(a.ws, 99);
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:5", "resync:unknownCursor:5"]);
    await c.live(c.aId);
    await vi.waitFor(() =>
      expect(c.shape(a.got)).toEqual(["welcome:5", "resync:unknownCursor:5", 6]),
    );
    a.ws.close();
  });

  it(`more than ${REPLAY_MAX_EVENTS} due gets resync tooMany; exactly ${REPLAY_MAX_EVENTS} replays`, async () => {
    const c = await setup();
    expect(REPLAY_MAX_EVENTS).toBe(500);
    await append(c.t, c.aId, 502, c.clock.now());
    const a = await c.sock(c.cookieA);
    c.hello(a.ws, 1);
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:502", "resync:tooMany:502"]);
    const zero = await c.sock(c.cookieA);
    c.hello(zero.ws, 0);
    await c.barrier(zero.ws, zero.got);
    expect(c.shape(zero.got)).toEqual(["welcome:502", "resync:tooMany:502"]);
    const cap = await c.sock(c.cookieA);
    c.hello(cap.ws, 2);
    await c.barrier(cap.ws, cap.got);
    const s = c.shape(cap.got);
    expect(s[0]).toBe("welcome:502");
    expect(s.slice(1)).toEqual(Array.from({ length: 500 }, (_, i) => i + 3));
    for (const x of [a.ws, zero.ws, cap.ws]) x.close();
  }, 30_000);

  it("a cursor whose next row is older than 24 h, or pruned, gets resync tooOld", async () => {
    const c = await setup();
    // the clock stays put (a 24 h advance would expire the session): old rows are written in the past
    await append(c.t, c.aId, 3, c.clock.now() - DAY - 1);
    await append(c.t, c.aId, 2, c.clock.now());
    const old = await c.sock(c.cookieA);
    c.hello(old.ws, 1);
    await c.barrier(old.ws, old.got);
    expect(c.shape(old.got)).toEqual(["welcome:5", "resync:tooOld:5"]);
    // the boundary: row 4 is fresh, so lastSeq 3 replays 4 and 5
    const fresh = await c.sock(c.cookieA);
    c.hello(fresh.ws, 3);
    await c.barrier(fresh.ws, fresh.got);
    expect(c.shape(fresh.got)).toEqual(["welcome:5", 4, 5]);
    // pruned: rows 1 to 3 are gone, so lastSeq 1 cannot be served even though row 4 is fresh
    expect(await withTransaction(c.t.deps.db, (tx) => pruneEventLog(tx, c.clock.now()))).toBe(3);
    const pruned = await c.sock(c.cookieA);
    c.hello(pruned.ws, 1);
    await c.barrier(pruned.ws, pruned.got);
    expect(c.shape(pruned.got)).toEqual(["welcome:5", "resync:tooOld:5"]);
    for (const x of [old.ws, fresh.ws, pruned.ws]) x.close();
  });

  it("a row exactly 24 h old is still replayed, for lastSeq 0 and for a cursor (#620 C-m1)", async () => {
    const c = await setup();
    // the test clock runs on real time; freeze it so the rows sit exactly on the cutoff (now - DAY)
    const frozen = c.clock.now();
    c.clock.now = () => frozen;
    await append(c.t, c.aId, 2, c.clock.now() - DAY);
    const edge = await c.sock(c.cookieA);
    c.hello(edge.ws, 0);
    await c.barrier(edge.ws, edge.got);
    expect(c.shape(edge.got)).toEqual(["welcome:2", 1, 2]);
    const cursor = await c.sock(c.cookieA);
    c.hello(cursor.ws, 1);
    await c.barrier(cursor.ws, cursor.got);
    expect(c.shape(cursor.got)).toEqual(["welcome:2", 2]);
    // one ms past the edge: lastSeq 2's next row (3) is too old
    await append(c.t, c.aId, 1, c.clock.now() - DAY - 1);
    await append(c.t, c.aId, 1, c.clock.now());
    const past = await c.sock(c.cookieA);
    c.hello(past.ws, 2);
    await c.barrier(past.ws, past.got);
    expect(c.shape(past.got)).toEqual(["welcome:4", "resync:tooOld:4"]);
    for (const x of [edge.ws, cursor.ws, past.ws]) x.close();
  });

  it("replays only the socket user's own rows; B's events never reach A (SEC-014)", async () => {
    const c = await setup();
    await append(c.t, c.bId, 4, c.clock.now());
    await append(c.t, c.aId, 2, c.clock.now());
    await append(c.t, c.bId, 3, c.clock.now());
    const a = await c.sock(c.cookieA);
    c.hello(a.ws, 0);
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:2", 1, 2]);
    const b = await c.sock(c.cookieB);
    c.hello(b.ws, 5);
    await c.barrier(b.ws, b.got);
    expect(c.shape(b.got)).toEqual(["welcome:7", 6, 7]);
    await c.live(c.bId);
    await vi.waitFor(() => expect(c.shape(b.got)).toEqual(["welcome:7", 6, 7, 8]));
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:2", 1, 2]);
    const ids = (got: Msg[]) =>
      got.flatMap((m) =>
        m.type === "sourceStatus" ? [(m as { correlationId: string }).correlationId] : [],
      );
    expect(ids(a.got)).toHaveLength(2);
    for (const id of ids(b.got)) expect(ids(a.got)).not.toContain(id);
    for (const x of [a.ws, b.ws]) x.close();
  });

  it.each([
    ["buffered before the answer", "before"],
    ["after the answer", "after"],
  ] as const)(
    "an event committed during the replay read arrives exactly once (published %s)",
    async (_label, when) => {
      const c = await setup();
      await append(c.t, c.aId, 3, c.clock.now());
      const a = await c.sock(c.cookieA);
      let committed: SourceStatusEvent | undefined;
      // the row commits before the read takes the lock, so the read sees it; the publish comes later
      replayHook.before = async () => {
        [committed] = await append(c.t, c.aId, 1, c.clock.now());
      };
      replayHook.after = () => {
        const publish = () => c.t.deps.eventBus.publish(c.aId, committed as SourceStatusEvent);
        if (when === "before") publish();
        else setTimeout(publish, 0);
      };
      c.hello(a.ws, 1);
      await c.barrier(a.ws, a.got);
      // the "after" publish fires on a timer inside the read hook; a second round trip follows it
      await c.barrier(a.ws, a.got);
      expect(c.shape(a.got)).toEqual(["welcome:4", 2, 3, 4]);
      await c.live(c.aId);
      await vi.waitFor(() => expect(c.shape(a.got)).toEqual(["welcome:4", 2, 3, 4, 5]));
      a.ws.close();
    },
  );

  it("lastSeq null gets welcome only, no replay; later live events flow", async () => {
    const c = await setup();
    await append(c.t, c.aId, 3, c.clock.now());
    const a = await c.sock(c.cookieA);
    c.hello(a.ws, null);
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:3"]);
    await c.live(c.aId);
    await vi.waitFor(() => expect(c.shape(a.got)).toEqual(["welcome:3", 4]));
    a.ws.close();
  });

  it("lastSeq 0 replays the rows of the last 24 h, skipping older ones without resync", async () => {
    const c = await setup();
    await append(c.t, c.aId, 2, c.clock.now() - DAY - 1);
    await append(c.t, c.aId, 2, c.clock.now());
    const a = await c.sock(c.cookieA);
    c.hello(a.ws, 0);
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:4", 3, 4]);
    a.ws.close();
  });

  it("lastSeq equal to latestSeq gets nothing and no resync, even when the newest row is old", async () => {
    const c = await setup();
    await append(c.t, c.aId, 3, c.clock.now() - DAY * 3);
    expect(await withTransaction(c.t.deps.db, (tx) => pruneEventLog(tx, c.clock.now()))).toBe(2);
    const a = await c.sock(c.cookieA);
    c.hello(a.ws, 3);
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:3"]);
    const none = await c.sock(c.cookieB);
    c.hello(none.ws, 0);
    await c.barrier(none.ws, none.got);
    expect(c.shape(none.got)).toEqual(["welcome:0"]);
    for (const x of [a.ws, none.ws]) x.close();
  });

  it("a live event published before hello is held, not sent ahead of welcome and the replay", async () => {
    const c = await setup();
    await append(c.t, c.aId, 3, c.clock.now());
    const a = await c.sock(c.cookieA);
    await c.live(c.aId);
    // a socket that has not said hello gets nothing yet
    await new Promise((r) => setTimeout(r, 20));
    expect(a.got).toEqual([]);
    c.hello(a.ws, 1);
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:4", 2, 3, 4]);
    a.ws.close();
  });

  it("flushes a held live event whose row the replay read did not see", async () => {
    const c = await setup();
    await append(c.t, c.aId, 3, c.clock.now());
    const a = await c.sock(c.cookieA);
    // after the read, before the answer: seq 4 commits and publishes while the server still holds
    // live events, so only the held flush can deliver it, once, after the replay (NFR-003)
    replayHook.after = async () => {
      await c.live(c.aId);
    };
    c.hello(a.ws, 1);
    await vi.waitFor(() => expect(c.shape(a.got)).toEqual(["welcome:3", 2, 3, 4]));
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:3", 2, 3, 4]);
    a.ws.close();
  });

  it("a second hello on the same socket is ignored and logged by id", async () => {
    const c = await setup();
    await append(c.t, c.aId, 3, c.clock.now());
    const a = await c.sock(c.cookieA);
    c.hello(a.ws, 1);
    c.hello(a.ws, 0);
    await c.barrier(a.ws, a.got);
    c.hello(a.ws, null);
    await c.barrier(a.ws, a.got);
    expect(c.shape(a.got)).toEqual(["welcome:3", 2, 3]);
    const lines = c.t.logLines.filter((l) => l.includes('"msg":"ws duplicate hello ignored"'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"sessionId":"');
    a.ws.close();
  });

  it("a replay read failure closes the socket with 1011 and logs the error class only", async () => {
    const c = await setup();
    await append(c.t, c.aId, 3, c.clock.now());
    const a = await c.sock(c.cookieA);
    const closed = new Promise<number>((r) => a.ws.once("close", (code) => r(code)));
    replayHook.fail = true;
    c.hello(a.ws, 1);
    expect(await closed).toBe(WS_LOCAL_CLOSE.internal);
    expect(a.got).toEqual([]);
    const line = c.t.logLines.find((l) => l.includes('"msg":"ws replay read failed"'));
    expect(line).toContain('"errorName":"Error"');
    expect(line).not.toContain("db down");
  });
});
