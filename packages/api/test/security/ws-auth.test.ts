import net from "node:net";
import { type WsEvent, WsServerMessageSchema } from "@querymodule/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("rejects a missing Origin with a cookie and an unsigned bearer (401)", async () => {
    // I2: an unsigned bearer (the raw session id with no "." signature suffix — better-auth's
    // requireSignature rejects that outright) must not let a forwarded cookie authenticate the
    // socket when Origin is absent. The cookie value itself is "id.signature"; the unsigned
    // bearer a client would send is just the "id" part.
    const { s, cookie } = await setup();
    const unsignedToken = cookie.split("=").slice(1).join("=").split(".")[0] ?? "";
    await expect(
      open(s.wsUrl, { cookie, authorization: `Bearer ${unsignedToken}` }),
    ).rejects.toThrow("HTTP 401");
  });

  it("rejects an unsigned bearer on its own (401)", async () => {
    const { s, cookie } = await setup();
    const unsignedToken = cookie.split("=").slice(1).join("=").split(".")[0] ?? "";
    await expect(open(s.wsUrl, { authorization: `Bearer ${unsignedToken}` })).rejects.toThrow(
      "HTTP 401",
    );
  });

  it("closes 4001 when isSessionLive rejects during a ping", async () => {
    // I1: isSessionLive resolves true for the post-registration race recheck, then rejects on
    // the ping itself; the socket must fail closed (4001), not crash with an unhandled rejection.
    const { t, cookie } = await setup();
    let calls = 0;
    const flakyDeps = {
      ...t.deps,
      identity: {
        ...t.deps.identity,
        isSessionLive: async () => {
          calls += 1;
          if (calls === 1) return true;
          throw new Error("db unavailable");
        },
      },
    };
    const flakyApp = { ...t, deps: flakyDeps } as TestApp;
    const s = await startTestServer(flakyApp);
    closers.push(s.close);
    const ws = await open(s.wsUrl, { origin: ORIGIN, cookie });
    const code = closeCode(ws);
    ws.send(JSON.stringify(ping("n4")));
    expect(await code).toBe(4001);
  });

  it("survives a client resetting the connection during a pending upgrade", async () => {
    // C1/Q1: nothing listened for 'error' on the raw upgrade socket while identity.resolve()
    // was pending, so a reset during that window used to crash the whole process. A later,
    // normal upgrade must still succeed.
    const { t, cookie } = await setup();
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const original = t.deps.identity.resolve.bind(t.deps.identity);
    let first = true;
    const slowDeps = {
      ...t.deps,
      identity: {
        ...t.deps.identity,
        resolve: async (req: Request) => {
          if (first) {
            first = false;
            await gate;
          }
          return original(req);
        },
      },
    };
    const slowApp = { ...t, deps: slowDeps } as TestApp;
    const s = await startTestServer(slowApp);
    closers.push(s.close);

    const port = Number(new URL(s.baseUrl).port);
    const socket = net.connect(port, "127.0.0.1");
    await new Promise<void>((r, j) => {
      socket.once("connect", () => r());
      socket.once("error", j);
    });
    socket.write(
      `GET /api/v1/ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nOrigin: ${ORIGIN}\r\nCookie: ${cookie}\r\n\r\n`,
    );
    await new Promise((r) => setTimeout(r, 20));
    socket.resetAndDestroy();
    release();
    await new Promise((r) => setTimeout(r, 50));

    const ws = await open(s.wsUrl, { origin: ORIGIN, cookie });
    ws.send(JSON.stringify(hello));
    expect(await nextMsg(ws)).toMatchObject({ type: "welcome" });
    ws.close();
  });
});

describe("SEC-014 upgrade costs no DB lookup before Origin and limit (#225)", () => {
  it("limits upgrades per IP: the 61st in a minute gets 429 with Retry-After", async () => {
    const { t, s, cookie } = await setup();
    const resolve = vi.spyOn(t.deps.identity, "resolve");
    // Cheap rejected upgrades (foreign Origin) still count against the per-IP limit.
    for (let i = 0; i < 60; i++)
      await expect(open(s.wsUrl, { origin: "https://evil.example.test", cookie })).rejects.toThrow(
        "HTTP 403",
      );
    const res = await new Promise<{ status: number; retryAfter: string | undefined }>((ok, rej) => {
      const ws = new WebSocket(s.wsUrl, { headers: { origin: ORIGIN, cookie } });
      ws.once("open", () => rej(new Error("upgraded")));
      ws.once("unexpected-response", (_q, r) =>
        ok({
          status: r.statusCode ?? 0,
          retryAfter: r.headers["retry-after"] as string | undefined,
        }),
      );
      ws.once("error", rej);
    });
    expect(res.status).toBe(429);
    expect(Number(res.retryAfter)).toBeGreaterThan(0);
    expect(resolve).not.toHaveBeenCalled();
  }, 30_000);
  it("a foreign Origin never reaches identity.resolve", async () => {
    const { t, s, cookie } = await setup();
    const resolve = vi.spyOn(t.deps.identity, "resolve");
    await expect(open(s.wsUrl, { origin: "https://evil.example.test", cookie })).rejects.toThrow(
      "HTTP 403",
    );
    expect(resolve).not.toHaveBeenCalled();
  });
  it("a missing Origin with only a cookie never reaches identity.resolve", async () => {
    const { t, s, cookie } = await setup();
    const resolve = vi.spyOn(t.deps.identity, "resolve");
    await expect(open(s.wsUrl, { cookie })).rejects.toThrow("HTTP 403");
    expect(resolve).not.toHaveBeenCalled();
  });
  it("a signed-bearer upgrade with no Origin still gets welcome", async () => {
    const { t, s } = await setup();
    const r = await t.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "" },
      body: JSON.stringify({ email: EMAIL, password: PW }),
    });
    const token = r.headers.get("set-auth-token") ?? "";
    const resolve = vi.spyOn(t.deps.identity, "resolve");
    const ws = await open(s.wsUrl, { authorization: `Bearer ${token}` });
    ws.send(JSON.stringify(hello));
    expect(await nextMsg(ws)).toMatchObject({ type: "welcome" });
    expect(resolve).toHaveBeenCalledTimes(1);
    ws.close();
  });
});
