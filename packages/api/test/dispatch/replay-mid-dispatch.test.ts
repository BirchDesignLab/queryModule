import { QueryDetailSchema } from "@querymodule/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import {
  barrier,
  closeServers,
  rowsOf,
  sendHello,
  setupDispatchApp,
  type WsMsg,
} from "../helpers/ws-replay";

/*
 * P1 gate, spec 10.4 and 12.3 "socket-close-mid-dispatch" (FR-065, NFR-003; #591): the
 * socket closes after the 202 and before the outcomes, the client reconnects with
 * hello { lastSeq: <last seen> }, every missed outcome arrives exactly once by replay in seq order,
 * and GET /api/v1/queries/:correlationId agrees with the replayed statuses. Another user's rows
 * never reach the replay (spec 5.3): B's seqs sit above A's cursor, so a missing owner filter
 * fails this test on its own. Mock data only: TIMEOUT (nationalSource never answers) and ZZ-0001
 * are the shipped mock's scenario values (spec 5.4, 10.8).
 */
afterEach(closeServers);

type Status = WsMsg & {
  type: "sourceStatus";
  seq: number;
  correlationId: string;
  sourceId: string;
  status: string;
};
type Msg = WsMsg & { latestSeq?: number; nonce?: string };
const isStatus = (m: Msg | Status): m is Status => m.type === "sourceStatus";

async function setup() {
  const base = await setupDispatchApp();
  const { t, time, aId, bId, cookieA, cookieB, submit } = base;
  const sock = (cookie: string) => base.sock<Msg | Status>(cookie);
  const hello = sendHello;
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
    bId,
    cookieA,
    cookieB,
    submit,
    sock,
    hello,
    barrier,
    close,
    settleAll,
    rowsOf: (userId: string) => rowsOf(t, userId),
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
    // another user's dispatches run while A is away (spec 5.3: never in A's replay); seq is per
    // user, so B's seqs 3 and 4 sit above A's cursor and only the owner filter keeps them out
    const others = [await c.submit(c.cookieB, "ZZ-0001"), await c.submit(c.cookieB, "ZZ-0001")];
    await c.settleAll();
    const rows = await c.rowsOf(c.aId);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await c.rowsOf(c.bId)).map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    expect(first.got.filter(isStatus)).toHaveLength(2);

    const again = await c.sock(c.cookieA);
    c.hello(again.ws, lastSeen);
    await vi.waitFor(() => expect(again.got.filter(isStatus)).toHaveLength(4));
    await c.barrier(again.ws, again.got);
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
    for (const other of others)
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
