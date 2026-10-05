import { SubmitQueryResponseSchema, WsServerMessageSchema } from "@querymodule/core/contracts";
import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { eventLog } from "../../src/db/schema";
import { manualTime } from "../helpers/manual-time";
import { createTestApp, startTestServer } from "../helpers/test-app";

// Spec 5.3, 12.7 M2 row "no cross-user events" (FR-065, SEC-014): sourceStatus events reach
// only the owner's sockets, in event_log order, and welcome.latestSeq reads event_log.
const PW = "correct-horse-battery-1";
const ORIGIN = "http://localhost:3000";
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

const open = (url: string, headers: Record<string, string>) =>
  new Promise<{ ws: WebSocket; got: unknown[] }>((res, rej) => {
    const ws = new WebSocket(url, { headers });
    const got: unknown[] = [];
    ws.on("message", (m) => got.push(JSON.parse(String(m))));
    ws.once("open", () => res({ ws, got }));
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
  const cookieA2 = await t.cookieFor("a@example.test", PW);
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
  const statuses = (got: unknown[]) =>
    got.filter((m) => (m as { type?: string }).type === "sourceStatus");
  const hello = (ws: WebSocket, got: unknown[]) => {
    const before = got.length;
    ws.send(JSON.stringify({ v: 1, type: "hello", lastSeq: null }));
    return vi.waitFor(() => {
      expect(got.length).toBeGreaterThan(before);
      return WsServerMessageSchema.parse(got[got.length - 1]);
    });
  };
  return { t, time, aId, cookieA, cookieA2, cookieB, submit, sock, statuses, hello };
}

describe("WebSocket event delivery (spec 5.3, FR-065, SEC-014)", () => {
  it("delivers sourceStatus only to the owner's sockets, matching event_log", async () => {
    const c = await setup();
    const a = await c.sock(c.cookieA);
    const a2 = await c.sock(c.cookieA2);
    const b = await c.sock(c.cookieB);
    await c.submit(c.cookieA, "ZZ-0001");
    await c.time.run(200);
    await vi.waitFor(() => expect(c.statuses(a.got)).toHaveLength(2));
    await vi.waitFor(() => expect(c.statuses(a2.got)).toHaveLength(2));
    const rows = await c.t.deps.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.userId, c.aId))
      .orderBy(asc(eventLog.seq));
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
    const a = await c.sock(c.cookieA);
    const closed = new Promise<number>((r) => a.ws.once("close", (code) => r(code)));
    await c.t.request("/api/v1/auth/sign-out", {
      method: "POST",
      headers: { cookie: c.cookieA, "x-requested-with": "querymodule" },
    });
    expect(await closed).toBe(4001);
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
});
