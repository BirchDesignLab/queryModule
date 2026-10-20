import { ApiErrorSchema } from "@querymodule/core/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { describe, expect, it, vi } from "vitest";
import { requestId, requireKnownOrigin } from "../../src/http/security";
import type { AppEnv } from "../../src/http/types";
import { createTestApp } from "../helpers/test-app";

// A foreign Origin is refused on every REST route (D-M2P3-1 option B, #753, #794; SEC-005,
// SEC-020; spec 5.3, 5.9, 10.3, 10.7). An absent or empty Origin passes (native clients).
const ALLOWED = "https://qm.example.test";
const FOREIGN = "https://evil.example.test";

function unit() {
  const handler = vi.fn();
  const logs: { msg: string; f: Record<string, unknown> }[] = [];
  const a = new Hono<AppEnv>();
  a.use("*", requestId());
  a.use(
    "/api/*",
    requireKnownOrigin([ALLOWED], (f) => logs.push({ msg: "refused", f })),
    cors({ origin: [ALLOWED], credentials: true }),
  );
  a.all("/api/v1/x", (c) => {
    handler();
    return c.json({ ok: true });
  });
  return { a, handler, logs };
}

const ORIGINS: [string, string | undefined, boolean][] = [
  ["allowed", ALLOWED, true],
  ["foreign", FOREIGN, false],
  ["null", "null", false],
  ["absent", undefined, true],
  ["empty", "", true],
];
const CREDS: [string, Record<string, string>][] = [
  ["cookie", { cookie: "qm_session=abc" }],
  ["bearer", { authorization: "Bearer abc" }],
  ["none", {}],
];
const METHODS: [string, Record<string, string>][] = [
  ["GET", {}],
  ["POST", { "x-requested-with": "querymodule" }],
  [
    "OPTIONS",
    { "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
  ],
];

describe("requireKnownOrigin matrix", () => {
  for (const [oName, origin, passes] of ORIGINS) {
    for (const [cName, cred] of CREDS) {
      for (const [method, extra] of METHODS) {
        it(`${oName} Origin, ${cName}, ${method}: ${passes ? "passes" : "403"}`, async () => {
          const { a, handler, logs } = unit();
          const r = await a.request("/api/v1/x", {
            method,
            headers: { ...(origin === undefined ? {} : { origin }), ...cred, ...extra },
          });
          if (passes) {
            expect(r.status).not.toBe(403);
            expect(logs).toHaveLength(0);
            if (method !== "OPTIONS") expect(handler).toHaveBeenCalledTimes(1);
          } else {
            expect(r.status).toBe(403);
            expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("forbidden");
            expect(handler).not.toHaveBeenCalled();
            expect(r.headers.get("access-control-allow-origin")).toBeNull();
            expect(logs).toHaveLength(1);
            expect(logs[0]?.f.class).toBe("foreign origin");
            expect(typeof logs[0]?.f.requestId).toBe("string");
            // never the Origin value (spec 5.9)
            expect(JSON.stringify(logs)).not.toContain("evil.example");
          }
        });
      }
    }
  }
});

describe("foreign Origin on the assembled app", () => {
  it("sign-in with a foreign Origin is 403: no session, no audit row, no handler", async () => {
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", "correct-horse-battery-1");
    const count = async () =>
      Number((await t.deps.db.$client.execute("SELECT count(*) AS n FROM audit_event")).rows[0]?.n);
    const before = await count();
    t.logLines.length = 0;
    const r = await t.signIn("dispatcher@example.test", "correct-horse-battery-1", {
      origin: FOREIGN,
    });
    expect(r.status).toBe(403);
    expect(r.headers.get("set-auth-token")).toBeNull();
    expect(r.headers.getSetCookie()).toHaveLength(0);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await count()).toBe(before);
    const log = t.logLines.join("\n");
    expect(log).toContain("foreign origin");
    expect(log).not.toContain("evil.example");
  });

  it("a foreign-Origin submit is 403 before the receipt mark and the body cap", async () => {
    const t = await createTestApp();
    const r = await t.request("/api/v1/queries", {
      method: "POST",
      headers: { origin: FOREIGN, "content-type": "application/json" },
      body: "x".repeat(40 * 1024),
    });
    expect(r.status).toBe(403);
  });

  it("a foreign-Origin preflight is 403; an own-Origin preflight is not", async () => {
    const t = await createTestApp();
    const pre = (origin: string) =>
      t.request("/api/v1/queries", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST" },
      });
    expect((await pre(FOREIGN)).status).toBe(403);
    expect((await pre(t.env.publicOrigin)).status).not.toBe(403);
  });

  it("dev origins pass only in development", async () => {
    const dev = await createTestApp({ env: { NODE_ENV: "development" } });
    const prod = await createTestApp();
    const get = (t: typeof dev) =>
      t.request("/api/v1/health", { headers: { origin: "http://localhost:5173" } });
    expect((await get(dev)).status).not.toBe(403);
    expect((await get(prod)).status).toBe(403);
  });

  it("CORS_ORIGINS admits exactly its origins", async () => {
    const t = await createTestApp({
      env: { CORS_ORIGINS: "https://a.example.test, https://b.example.test" },
    });
    const get = (origin: string) => t.request("/api/v1/health", { headers: { origin } });
    expect((await get("https://a.example.test")).status).not.toBe(403);
    expect((await get("https://b.example.test")).status).not.toBe(403);
    expect((await get("https://c.example.test")).status).toBe(403);
    expect((await get("http://localhost:3000")).status).toBe(403);
  });
});
