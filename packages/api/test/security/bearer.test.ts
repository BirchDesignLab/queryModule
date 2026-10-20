import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createTestApp, startTestServer, type TestApp } from "../helpers/test-app";

// Bearer auth on REST and on the WebSocket upgrade (spec 5.3, 5.6, 10.3, 10.7; SEC-005, SEC-014).
// A native client signs in with no Origin header, receives set-auth-token, and presents it as
// Authorization: Bearer. A browser always sends Origin, never receives the token, and uses the
// httpOnly cookie.
const MIN = 60_000;
const EMAIL = "dispatcher@example.test";
const OTHER = "records@example.test";
const PW = "correct-horse-battery-1";
const FOREIGN = "https://evil.example.test";
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

const signInBody = (email: string) => JSON.stringify({ email, password: PW });
/** A native sign-in: an empty Origin header, which the app treats as absent (t.request always sets one). */
const nativeSignIn = (t: TestApp, email: string) =>
  t.request("/api/v1/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "" },
    body: signInBody(email),
  });
async function nativeToken(t: TestApp, email: string) {
  const token = (await nativeSignIn(t, email)).headers.get("set-auth-token") ?? "";
  if (!token) throw new Error("no set-auth-token on a native sign-in");
  return token;
}
/** A bearer request: no cookie, no Origin unless the test sets one. */
const bearer = (t: TestApp, path: string, token: string, init: RequestInit = {}) =>
  t.request(path, {
    ...init,
    headers: {
      origin: "",
      authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

async function setup() {
  const t = await createTestApp();
  const userId = await t.createUser(EMAIL, PW);
  const token = await nativeToken(t, EMAIL);
  const s = await startTestServer(t);
  closers.push(s.close);
  return { t, s, token, userId };
}

const open = (url: string, headers: Record<string, string>) =>
  new Promise<WebSocket>((res, rej) => {
    const ws = new WebSocket(url, { headers });
    ws.once("open", () => res(ws));
    ws.once("unexpected-response", (_q, r) => rej(new Error(`HTTP ${r.statusCode}`)));
    ws.once("error", rej);
  });
/** Fails with the step's name instead of a bare vitest timeout. */
const within = <T>(step: string, p: Promise<T>, ms = 3000) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`timed out waiting for ${step}`)), ms),
    ),
  ]);
const closeCode = (ws: WebSocket) =>
  within("socket close", new Promise<number>((r) => ws.once("close", (code) => r(code))));
const nextMsg = (ws: WebSocket) =>
  within(
    "socket message",
    new Promise<unknown>((r) => ws.once("message", (d) => r(JSON.parse(String(d))))),
  );
const hello = { v: 1, type: "hello", lastSeq: null };

describe("bearer token issue (spec 5.6, 10.7)", () => {
  it("a sign-in with no Origin returns set-auth-token", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    const r = await nativeSignIn(t, EMAIL);
    expect(r.status).toBe(200);
    expect(r.headers.get("set-auth-token") ?? "").not.toBe("");
  });

  it("a web sign-in (with Origin) does not expose the token, header or CORS expose list", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    const r = await t.signIn(EMAIL, PW);
    expect(r.status).toBe(200);
    expect(r.headers.get("set-auth-token")).toBeNull();
    expect(r.headers.get("access-control-expose-headers") ?? "").not.toMatch(/set-auth-token/i);
  });
});

describe("bearer on REST (spec 10.3, 10.7; SEC-005, SEC-014)", () => {
  it("GET /api/v1/queries with a signed bearer and no cookie works", async () => {
    const { t, token } = await setup();
    const r = await bearer(t, "/api/v1/queries", token);
    expect(r.status).toBe(200);
  });

  it("POST /api/v1/queries with a signed bearer and no cookie passes auth; it still needs X-Requested-With", async () => {
    const { t, token } = await setup();
    const post = (h: Record<string, string>) =>
      bearer(t, "/api/v1/queries", token, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
          ...h,
        },
        body: JSON.stringify({}),
      });
    // Without the CSRF header the request is refused before auth.
    expect((await post({})).status).toBe(403);
    // With it, auth passes: the empty body then fails validation (400), not 401 or 403.
    const r = await post({ "x-requested-with": "querymodule" });
    expect(r.status).toBe(400);
  });

  it("an unsigned token (the raw session id) is 401", async () => {
    const { t, token } = await setup();
    const unsigned = token.split(".")[0] ?? "";
    expect(unsigned).not.toBe(token);
    expect((await bearer(t, "/api/v1/queries", unsigned)).status).toBe(401);
  });

  it("a tampered signature is 401", async () => {
    const { t, token } = await setup();
    const [id = "", sig = ""] = token.split(".");
    const flipped = sig.startsWith("A") ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect((await bearer(t, "/api/v1/queries", `${id}.${flipped}`)).status).toBe(401);
    expect((await bearer(t, "/api/v1/queries", `${id}x.${sig}`)).status).toBe(401);
  });

  it("a garbage or empty bearer is 401", async () => {
    const { t } = await setup();
    expect((await bearer(t, "/api/v1/queries", "not-a-token")).status).toBe(401);
    expect((await bearer(t, "/api/v1/queries", "")).status).toBe(401);
  });

  it("a bearer with a foreign Origin is refused 403, and a foreign-Origin sign-in gets no token", async () => {
    const { t, token } = await setup();
    // D-M2P3-1: a present, foreign Origin is refused before auth, CORS or any handler.
    const r = await bearer(t, "/api/v1/queries", token, { headers: { origin: FOREIGN } });
    expect(r.status).toBe(403);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await t.request("/api/v1/queries", {
      method: "OPTIONS",
      headers: {
        origin: FOREIGN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    expect(pre.status).toBe(403);
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    const si = await t.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: FOREIGN },
      body: signInBody(EMAIL),
    });
    expect(si.status).toBe(403);
    expect(si.headers.get("set-auth-token")).toBeNull();
  });
});

describe("bearer session limits (spec 5.6, SEC-005)", () => {
  it("a bearer session obeys the idle limit", async () => {
    const { t, token } = await setup();
    t.clock.advance(31 * MIN);
    expect((await bearer(t, "/api/v1/queries", token)).status).toBe(401);
  });

  it("activity refreshes the idle clock; X-Background: 1 does not", async () => {
    const { t, token, userId } = await setup();
    const t0 = await t.sessionUpdatedAt(userId);
    t.clock.advance(20 * MIN);
    const bg = await bearer(t, "/api/v1/queries", token, { headers: { "x-background": "1" } });
    expect(bg.status).toBe(200);
    expect(await t.sessionUpdatedAt(userId)).toBe(t0);
    // The background call did not keep it alive: 20 + 11 minutes since sign-in is past idle.
    t.clock.advance(11 * MIN);
    expect((await bearer(t, "/api/v1/queries", token)).status).toBe(401);
  });

  it("a normal bearer request does refresh the idle clock", async () => {
    const { t, token, userId } = await setup();
    const t0 = await t.sessionUpdatedAt(userId);
    t.clock.advance(20 * MIN);
    expect((await bearer(t, "/api/v1/queries", token)).status).toBe(200);
    expect(await t.sessionUpdatedAt(userId)).toBeGreaterThan(t0);
    t.clock.advance(20 * MIN);
    expect((await bearer(t, "/api/v1/queries", token)).status).toBe(200);
  });
});

describe("bearer on the WebSocket upgrade (spec 5.3, 10.3)", () => {
  it("accepts a bearer with no Origin; hello is answered", async () => {
    const { s, token } = await setup();
    const ws = await open(s.wsUrl, { authorization: `Bearer ${token}` });
    ws.send(JSON.stringify(hello));
    expect(await nextMsg(ws)).toMatchObject({ type: "welcome" });
    ws.close();
  });

  it("rejects a token in the query string (400), even with a valid bearer header", async () => {
    const { s, token } = await setup();
    await expect(open(`${s.wsUrl}?token=${token}`, {})).rejects.toThrow("HTTP 400");
    await expect(
      open(`${s.wsUrl}?token=${token}`, { authorization: `Bearer ${token}` }),
    ).rejects.toThrow("HTTP 400");
  });

  it("rejects an unsigned or tampered bearer (401)", async () => {
    const { s, token } = await setup();
    const [id = "", sig = ""] = token.split(".");
    await expect(open(s.wsUrl, { authorization: `Bearer ${id}` })).rejects.toThrow("HTTP 401");
    await expect(open(s.wsUrl, { authorization: `Bearer ${id}.${sig}00` })).rejects.toThrow(
      "HTTP 401",
    );
  });

  it("rejects a bearer carried with a foreign Origin (403)", async () => {
    const { s, token } = await setup();
    await expect(
      open(s.wsUrl, { origin: FOREIGN, authorization: `Bearer ${token}` }),
    ).rejects.toThrow("HTTP 403");
  });

  it("a bearer socket closes 4001 when the session idles out", async () => {
    const { t, s, token } = await setup();
    const ws = await open(s.wsUrl, { authorization: `Bearer ${token}` });
    const code = closeCode(ws);
    t.clock.advance(31 * MIN);
    ws.send(JSON.stringify({ v: 1, type: "ping", nonce: "b1" }));
    expect(await code).toBe(4001);
  });
});

describe("bearer sign-out and isolation (spec 5.3, 5.6)", () => {
  it("sign-out with the bearer ends the session and closes its socket with 4001", async () => {
    const { t, s, token } = await setup();
    const ws = await open(s.wsUrl, { authorization: `Bearer ${token}` });
    const code = closeCode(ws);
    const out = await bearer(t, "/api/v1/auth/sign-out", token, {
      method: "POST",
      headers: { "x-requested-with": "querymodule" },
    });
    expect(out.status).toBe(200);
    expect(await code).toBe(4001);
    expect(await t.auditRows("logout")).toHaveLength(1);
    expect((await bearer(t, "/api/v1/queries", token)).status).toBe(401);
    await expect(open(s.wsUrl, { authorization: `Bearer ${token}` })).rejects.toThrow("HTTP 401");
  });

  it("no event crosses users on a bearer socket", async () => {
    const { t, s, token } = await setup();
    const otherUser = await t.createUser(OTHER, PW);
    const otherToken = await nativeToken(t, OTHER);
    const a = await open(s.wsUrl, { authorization: `Bearer ${token}` });
    const b = await open(s.wsUrl, { authorization: `Bearer ${otherToken}` });
    for (const x of [a, b]) {
      const welcome = nextMsg(x);
      x.send(JSON.stringify(hello));
      expect(await welcome).toMatchObject({ type: "welcome", latestSeq: 0 });
    }
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
    } as const;
    const bGot = nextMsg(b);
    t.deps.eventBus.publish(otherUser, ev);
    expect(await bGot).toEqual(ev);
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toEqual([]);
    a.close();
    b.close();
  });
});
