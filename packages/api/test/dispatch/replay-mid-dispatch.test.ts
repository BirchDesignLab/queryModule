import {
  QueryDetailSchema,
  SubmitQueryResponseSchema,
  WsServerMessageSchema,
} from "@querymodule/core/contracts";
import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { eventLog } from "../../src/db/schema";
import { manualTime } from "../helpers/manual-time";
import { createTestApp, startTestServer } from "../helpers/test-app";

/*
 * P1 gate, spec 10.4 and 12.3 "socket-close-mid-dispatch" (FR-065, NFR-003, SEC-014; #591): the
 * socket closes after the 202 and before the outcomes, the client reconnects with
 * hello { lastSeq: <last seen> }, every missed outcome arrives exactly once by replay in seq order,
 * and GET /api/v1/queries/:correlationId agrees with the replayed statuses. Mock data only: TIMEOUT
 * (nationalSource never answers) and ZZ-0001 are the shipped mock's scenario values (spec 5.4, 10.8).
 */
const PW = "correct-horse-battery-1";
const ORIGIN = "http://localhost:3000";
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

type Status = {
  type: "sourceStatus";
  seq: number;
  correlationId: string;
  sourceId: string;
  status: string;
};
type Msg = { type: string; latestSeq?: number; nonce?: string } | Status;
const isStatus = (m: Msg): m is Status => m.type === "sourceStatus";

const open = (url: string, headers: Record<string, string>) =>
  new Promise<{ ws: WebSocket; got: Msg[]; raw: string[] }>((res, rej) => {
    const ws = new WebSocket(url, { headers });
    const got: Msg[] = [];
    const raw: string[] = [];
    ws.on("message", (m) => {
      raw.push(String(m));
      got.push(WsServerMessageSchema.parse(JSON.parse(String(m))) as Msg);
    });
    ws.once("open", () => res({ ws, got, raw }));
    ws.once("error", rej);
  });

async function setup() {
  const time = manualTime();
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
  });
  const aId = await t.createUser("a@example.test", PW);
  await t.createUser("b@example.test", PW);
  const cookieA = await t.cookieFor("a@example.test", PW);
  const cookieB = await t.cookieFor("b@example.test", PW);
  const s = await startTestServer(t);
  closers.push(s.close);
  const { configHash } = t.deps.config.current();
  async function submit(cookie: string, plate: string) {
    const r = await t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        queryType: "VEH",
        values: { plate, state: "TX" },
        sourceIds: ["stateSource", "nationalSource"],
        mode: "normal",
        configHash,
      }),
    });
    expect(r.status).toBe(202);
    return SubmitQueryResponseSchema.parse(await r.json());
  }
  const sock = (cookie: string) => open(s.wsUrl, { origin: ORIGIN, cookie });
  const hello = (ws: WebSocket, lastSeq: number | null) =>
    ws.send(JSON.stringify({ v: 1, type: "hello", lastSeq }));
  /** A ping answered after the replay: everything the hello sends is in (test/ws/replay.test.ts). */
  const barrier = async (ws: WebSocket, got: Msg[]) => {
    const nonce = crypto.randomUUID();
    ws.send(JSON.stringify({ v: 1, type: "ping", nonce }));
    await vi.waitFor(() => expect(got.some((m) => "nonce" in m && m.nonce === nonce)).toBe(true));
  };
  const close = (ws: WebSocket) =>
    new Promise<void>((r) => {
      ws.once("close", () => r());
      ws.close();
    });
  /** Lets every adapter answer or time out (10 000 ms) and T2 commit. */
  async function settleAll() {
    await time.run(20_000);
    await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
  }
  const rowsOf = (userId: string) =>
    t.deps.db.select().from(eventLog).where(eq(eventLog.userId, userId)).orderBy(asc(eventLog.seq));
  async function read(correlationId: string) {
    const r = await t.request(`/api/v1/queries/${correlationId}`, { headers: { cookie: cookieA } });
    expect(r.status).toBe(200);
    return QueryDetailSchema.parse(await r.json());
  }
  /** The GET detail's (sourceId, status) pairs, for comparison with the replayed events. */
  const httpStatuses = async (correlationId: string) =>
    ((await read(correlationId)).parts[0]?.sources ?? []).map((x) => `${x.sourceId}:${x.status}`);
  const replayed = (got: Msg[], correlationId: string) =>
    got
      .filter(isStatus)
      .filter((m) => m.correlationId === correlationId)
      .map((m) => `${m.sourceId}:${m.status}`);
  return {
    t,
    time,
    aId,
    cookieA,
    cookieB,
    submit,
    sock,
    hello,
    barrier,
    close,
    settleAll,
    rowsOf,
    httpStatuses,
    replayed,
  };
}

describe("socket closed mid-dispatch, replay on reconnect (spec 10.4, 12.3 P1 gate; FR-065, NFR-003)", () => {
  it("closed after the 202 and before the outcomes: every outcome arrives once by replay, matching GET", async () => {
    const c = await setup();
    const first = await c.sock(c.cookieA);
    c.hello(first.ws, null);
    await vi.waitFor(() => expect(first.got).toMatchObject([{ type: "welcome", latestSeq: 0 }]));
    // an earlier query seen live, so the cursor is a real "last seen" seq, not 0
    await c.submit(c.cookieA, "ZZ-0001");
    await c.settleAll();
    await vi.waitFor(() => expect(first.got.filter(isStatus)).toHaveLength(2));
    const lastSeen = Math.max(...first.got.filter(isStatus).map((m) => m.seq));
    expect(lastSeen).toBe(2);

    const slow = await c.submit(c.cookieA, "TIMEOUT");
    const fast = await c.submit(c.cookieA, "ZZ-0001");
    // no outcome yet: manual time has not moved since the 202s
    expect(await c.rowsOf(c.aId)).toHaveLength(2);
    await c.close(first.ws);
    // another user's dispatch runs while A is away (SEC-014: never in A's replay)
    const other = await c.submit(c.cookieB, "ZZ-0001");
    await c.settleAll();
    const rows = await c.rowsOf(c.aId);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(first.got.filter(isStatus)).toHaveLength(2);

    const again = await c.sock(c.cookieA);
    c.hello(again.ws, lastSeen);
    await vi.waitFor(() => expect(again.got.filter(isStatus)).toHaveLength(4));
    await c.barrier(again.ws, again.got);
    await new Promise((r) => setTimeout(r, 20));
    const events = again.got.filter(isStatus);
    // welcome first, then seq 3 to 6 once each, in seq order
    expect(again.got[0]).toMatchObject({ type: "welcome", latestSeq: 6 });
    expect(events.map((m) => m.seq)).toEqual([3, 4, 5, 6]);
    expect(new Set(events.map((m) => `${m.correlationId}:${m.sourceId}`)).size).toBe(4);
    // the replayed rows are the stored ones (ids and status)
    expect(events).toMatchObject(
      rows.slice(2).map((r) => ({
        seq: r.seq,
        correlationId: r.correlationId,
        sourceId: r.sourceId,
        resultId: r.resultId,
        status: r.status,
      })),
    );
    expect(events.map((m) => m.correlationId)).not.toContain(other.correlationId);
    // the HTTP read agrees with the replay, source by source
    for (const ack of [slow, fast]) {
      expect(c.replayed(events, ack.correlationId).sort()).toEqual(
        (await c.httpStatuses(ack.correlationId)).sort(),
      );
    }
    expect(c.replayed(events, slow.correlationId)).toContain("nationalSource:timedOut");
    expect(c.replayed(events, fast.correlationId).sort()).toEqual([
      "nationalSource:returned",
      "stateSource:returned",
    ]);
    // events are reference-only: no value or payload crosses the socket (spec 5.9)
    const wire = again.raw.join("\n");
    for (const v of ["ZZ-0001", "TIMEOUT", "STOLEN"]) expect(wire).not.toContain(v);
    again.ws.close();
  });

  it("closed after the first outcomes (staggered latency): only the missed one is replayed, once", async () => {
    const c = await setup();
    const first = await c.sock(c.cookieA);
    c.hello(first.ws, null);
    await vi.waitFor(() => expect(first.got).toMatchObject([{ type: "welcome", latestSeq: 0 }]));
    const slow = await c.submit(c.cookieA, "TIMEOUT");
    // the mock's latency is at most 800 ms; nationalSource's TIMEOUT deadline is 10 000 ms
    await c.time.run(1_000);
    await vi.waitFor(() => expect(first.got.filter(isStatus)).toHaveLength(1));
    const seen = first.got.filter(isStatus);
    expect(seen).toMatchObject([{ seq: 1, sourceId: "stateSource" }]);
    await c.close(first.ws);
    await c.settleAll();
    expect((await c.rowsOf(c.aId)).map((r) => r.seq)).toEqual([1, 2]);

    const again = await c.sock(c.cookieA);
    c.hello(again.ws, 1);
    await vi.waitFor(() => expect(again.got.filter(isStatus)).toHaveLength(1));
    await c.barrier(again.ws, again.got);
    await new Promise((r) => setTimeout(r, 20));
    expect(again.got[0]).toMatchObject({ type: "welcome", latestSeq: 2 });
    const events = again.got.filter(isStatus);
    expect(events).toMatchObject([
      {
        seq: 2,
        correlationId: slow.correlationId,
        sourceId: "nationalSource",
        status: "timedOut",
      },
    ]);
    // seen live plus replayed is the whole query, and GET agrees
    const whole = [
      ...c.replayed(seen, slow.correlationId),
      ...c.replayed(events, slow.correlationId),
    ];
    expect(whole.sort()).toEqual((await c.httpStatuses(slow.correlationId)).sort());
    again.ws.close();
  });
});
