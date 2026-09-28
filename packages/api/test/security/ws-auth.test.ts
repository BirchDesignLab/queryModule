import { type WsEvent, WsServerMessageSchema } from "@querymodule/core/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createTestApp, startTestServer, type TestApp } from "../helpers/test-app";

const MIN = 60_000;
const EMAIL = "dispatcher@example.test";
const PW = "correct-horse-battery-1";
const ORIGIN = "http://localhost:3000";
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function setup(o: { idleMs?: number } = {}) {
  const t = await createTestApp();
  await t.createUser(EMAIL, PW);
  const cookie = await t.cookieFor(EMAIL, PW);
  const s = await startTestServer(t, o);
  closers.push(s.close);
  return { t, s, cookie };
}
const open = (url: string, headers: Record<string, string>) =>
  new Promise<WebSocket>((res, rej) => {
    const ws = new WebSocket(url, { headers });
    ws.once("open", () => res(ws));
    ws.once("unexpected-response", (_q, r) => rej(new Error(`HTTP ${r.statusCode}`)));
    ws.once("error", rej);
  });
const closeCode = (ws: WebSocket) =>
  new Promise<number>((r) => ws.once("close", (code) => r(code)));
const nextMsg = (ws: WebSocket) =>
  new Promise<unknown>((r) => ws.once("message", (d) => r(JSON.parse(String(d)))));
const hello = { v: 1, type: "hello", lastSeq: null };
const ping = (nonce: string) => ({ v: 1, type: "ping", nonce });

describe("SEC-014 WebSocket upgrade and heartbeat", () => {
  it("accepts a live session with the deployed Origin; hello and ping answer", async () => {
    const { s, cookie } = await setup();
    const ws = await open(s.wsUrl, { origin: ORIGIN, cookie });
    ws.send(JSON.stringify(hello));
    expect(WsServerMessageSchema.parse(await nextMsg(ws))).toMatchObject({
      type: "welcome",
      latestSeq: 0,
    });
    ws.send(JSON.stringify(ping("n1")));
    expect(WsServerMessageSchema.parse(await nextMsg(ws))).toMatchObject({
      type: "pong",
      nonce: "n1",
    });
    ws.close();
  });
  it("rejects with no session (401)", async () => {
    const { s } = await setup();
    await expect(open(s.wsUrl, { origin: ORIGIN })).rejects.toThrow("HTTP 401");
  });
  it("rejects an expired session (401)", async () => {
    const { t, s, cookie } = await setup();
    t.clock.advance(31 * MIN);
    await expect(open(s.wsUrl, { origin: ORIGIN, cookie })).rejects.toThrow("HTTP 401");
  });
  it("rejects a foreign Origin (403)", async () => {
    const { s, cookie } = await setup();
    await expect(open(s.wsUrl, { origin: "https://evil.example.test", cookie })).rejects.toThrow(
      "HTTP 403",
    );
  });
  it("rejects a missing Origin with a cookie (403)", async () => {
    const { s, cookie } = await setup();
    await expect(open(s.wsUrl, { cookie })).rejects.toThrow("HTTP 403");
  });
  it("rejects a token in the query string (400)", async () => {
    const { s, cookie } = await setup();
    await expect(open(`${s.wsUrl}?token=abc`, { origin: ORIGIN, cookie })).rejects.toThrow(
      "HTTP 400",
    );
  });
  it("accepts a missing Origin with Authorization: Bearer", async () => {
    const { t, s } = await setup();
    // A native (non-web) client sign-in carries no Origin header, so Better Auth's bearer
    // plugin exposes set-auth-token: stripWebBearerToken (auth.ts) only strips it when the
    // request has an Origin, as a browser's always does.
    const r = await t.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "" },
      body: JSON.stringify({ email: EMAIL, password: PW }),
    });
    const token = r.headers.get("set-auth-token") ?? "";
    expect(token).not.toBe("");
    const ws = await open(s.wsUrl, { authorization: `Bearer ${token}` });
    ws.send(JSON.stringify(hello));
    expect(await nextMsg(ws)).toMatchObject({ type: "welcome" });
    ws.close();
  });
  it("closes 4001 on logout and pushes nothing after", async () => {
    const { t, s, cookie } = await setup();
    const ws = await open(s.wsUrl, { origin: ORIGIN, cookie });
    const code = closeCode(ws);
    await t.request("/api/v1/auth/sign-out", { method: "POST", headers: { cookie } });
    expect(await code).toBe(4001);
  });
  it("closes 4001 when the session expires while open", async () => {
    const { t, s, cookie } = await setup();
    const ws = await open(s.wsUrl, { origin: ORIGIN, cookie });
    const code = closeCode(ws);
    t.clock.advance(31 * MIN);
    ws.send(JSON.stringify(ping("n2")));
    expect(await code).toBe(4001);
  });
  it("no event crosses users", async () => {
    const { t, s, cookie } = await setup();
    await t.createUser("records@example.test", PW);
    const other = await t.cookieFor("records@example.test", PW);
    const a = await open(s.wsUrl, { origin: ORIGIN, cookie });
    const b = await open(s.wsUrl, { origin: ORIGIN, cookie: other });
    const bUser = (await t.auditRows("loginSucceeded")).at(-1)?.actorUserId ?? "";
    const got: unknown[] = [];
    a.on("message", (m) => got.push(JSON.parse(String(m))));
    const ev = {
      v: 1,
      type: "sourceStatus",
      seq: 1,
      at: 1,
      correlationId: "0190a000-0000-7000-8000-000000000001",
      partId: 0,
      sourceId: "s",
      resultId: "0190a000-0000-7000-8000-000000000002",
      status: "returned",
    } as WsEvent;
    const bGot = nextMsg(b);
    t.deps.eventBus.publish(bUser, ev);
    expect(await bGot).toEqual(ev);
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toEqual([]);
    a.close();
    b.close();
  });
  it("closes a socket that sends no ping within the idle window", async () => {
    const { s, cookie } = await setup({ idleMs: 200 });
    const ws = await open(s.wsUrl, { origin: ORIGIN, cookie });
    expect(await closeCode(ws)).toBe(4000);
  });

  it("upgrade and ping never bump the session idle clock (X-Background)", async () => {
    const t = await createTestApp();
    const userId = await t.createUser(EMAIL, PW);
    const cookie = await t.cookieFor(EMAIL, PW);
    const before = await t.sessionUpdatedAt(userId);
    t.clock.advance(5 * MIN);
    const s = await startTestServer(t);
    closers.push(s.close);
    const ws = await open(s.wsUrl, { origin: ORIGIN, cookie });
    ws.send(JSON.stringify(hello));
    await nextMsg(ws);
    ws.send(JSON.stringify(ping("n3")));
    await nextMsg(ws);
    ws.close();
    expect(await t.sessionUpdatedAt(userId)).toBe(before);
  });

  it("closes 4001 when the session already ended before onSessionEnded registration completes", async () => {
    // Simulates the race between identity.resolve() succeeding and the socket registering
    // its own eventBus.onSessionEnded handler: isSessionLive already reports the session as
    // gone (as if endSession had already run and fired to an empty handler set), so the
    // post-registration recheck must close the socket itself.
    const { t, cookie } = await setup();
    const raceDeps = {
      ...t.deps,
      identity: { ...t.deps.identity, isSessionLive: async () => false },
    };
    const raceApp = { ...t, deps: raceDeps } as TestApp;
    const s = await startTestServer(raceApp);
    closers.push(s.close);
    const ws = await open(s.wsUrl, { origin: ORIGIN, cookie });
    expect(await closeCode(ws)).toBe(4001);
  });
});
