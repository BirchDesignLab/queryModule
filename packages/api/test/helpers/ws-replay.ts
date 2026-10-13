import {
  SubmitQueryResponseSchema,
  WS_PROTOCOL_VERSION,
  type WsServerMessage,
  WsServerMessageSchema,
} from "@querymodule/core/contracts";
import { asc, eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import WebSocket from "ws";
import { eventLog } from "../../src/db/schema";
import { manualTime } from "./manual-time";
import { createTestApp, startTestServer, type TestApp } from "./test-app";

// Shared by the replay and event-delivery tests (test/ws/replay.test.ts,
// test/dispatch/replay-mid-dispatch.test.ts, test/security/ws-events.test.ts).
export const PW = "correct-horse-battery-1";
export const ORIGIN = "http://localhost:3000";

const closers: (() => Promise<void>)[] = [];
/** Closes every server a setup started; call it from afterEach. */
export async function closeServers() {
  for (const c of closers.splice(0)) await c();
}

/** A server-message view; a test may pass its own looser shape as M. */
export type WsMsg = { type: string };

/** Opens a socket; every frame is validated against WsServerMessageSchema, then kept in got. */
export const openSocket = <M extends WsMsg = WsServerMessage>(
  url: string,
  headers: Record<string, string>,
) =>
  new Promise<{ ws: WebSocket; got: M[]; raw: string[] }>((res, rej) => {
    const ws = new WebSocket(url, { headers });
    const got: M[] = [];
    const raw: string[] = [];
    ws.on("message", (m) => {
      raw.push(String(m));
      got.push(WsServerMessageSchema.parse(JSON.parse(String(m))) as unknown as M);
    });
    ws.once("open", () => res({ ws, got, raw }));
    ws.once("error", rej);
  });

export const sendHello = (ws: WebSocket, lastSeq: number | null) =>
  ws.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, type: "hello", lastSeq }));

/**
 * A ping is answered after the hello's replay read and after every frame queued before it, so
 * what the socket was sent by then is in got. A second call after an async publish settles
 * proves nothing more arrives: no fixed sleep needed.
 */
export async function barrier(ws: WebSocket, got: WsMsg[]) {
  const nonce = crypto.randomUUID();
  ws.send(JSON.stringify({ v: WS_PROTOCOL_VERSION, type: "ping", nonce }));
  await vi.waitFor(() =>
    expect(got.some((m) => m.type === "pong" && (m as { nonce?: string }).nonce === nonce)).toBe(
      true,
    ),
  );
}

/** event_log rows of one user in seq order. */
export const rowsOf = (t: TestApp, userId: string) =>
  t.deps.db.select().from(eventLog).where(eq(eventLog.userId, userId)).orderBy(asc(eventLog.seq));

/**
 * An assembled app on manual time with users a and b, a started server and the VEH submit helper
 * the dispatch-driven tests share. Mock data only (ZZ- plates).
 */
export async function setupDispatchApp() {
  const time = manualTime();
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
  });
  const aId = await t.createUser("a@example.test", PW);
  const bId = await t.createUser("b@example.test", PW);
  const cookieA = await t.cookieFor("a@example.test", PW);
  const cookieA2 = await t.cookieFor("a@example.test", PW);
  const cookieB = await t.cookieFor("b@example.test", PW);
  const s = await startTestServer(t);
  closers.push(s.close);
  const { configHash } = t.deps.config.current();
  async function submit(
    cookie: string,
    plate: string,
    sourceIds = ["stateSource", "nationalSource"],
  ) {
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
        sourceIds,
        mode: "normal",
        configHash,
      }),
    });
    expect(r.status).toBe(202);
    return SubmitQueryResponseSchema.parse(await r.json());
  }
  const sock = <M extends WsMsg = WsServerMessage>(cookie: string) =>
    openSocket<M>(s.wsUrl, { origin: ORIGIN, cookie });
  return { t, time, aId, bId, cookieA, cookieA2, cookieB, submit, sock };
}
