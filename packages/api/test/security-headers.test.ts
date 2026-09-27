import { ApiErrorSchema } from "@querymodule/core/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { readDeployEnv } from "../src/env";
import {
  bodyCap,
  buildCsp,
  noStore,
  requestId,
  requireRequestedWith,
  securityHeaders,
} from "../src/http/security";
import type { AppEnv } from "../src/http/types";

function app() {
  const a = new Hono<AppEnv>();
  a.use("*", requestId(), securityHeaders());
  a.use("/api/*", noStore());
  a.use("/api/v1/*", bodyCap(), requireRequestedWith());
  a.get("/api/v1/x", (c) => c.json({ ok: true }));
  a.post("/api/v1/y", (c) => c.json({ ok: true }));
  a.post("/api/v1/auth/sign-in/email", (c) => c.json({ ok: true }));
  a.post("/api/v1/auth/embedded", (c) => c.json({ ok: true }));
  a.post("/api/v1/auth/embedded/", (c) => c.json({ ok: true }));
  a.post("/api/v1/auth/embedded/sub", (c) => c.json({ ok: true }));
  a.post("/api/v1/auth/EMBEDDED", (c) => c.json({ ok: true }));
  return a;
}

describe("SEC-006 SEC-007 baseline", () => {
  it("sets security headers and no-store on /api", async () => {
    const r = await app().request("/api/v1/x");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(r.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("403 forbidden without X-Requested-With on state-changing non-auth routes", async () => {
    const r = await app().request("/api/v1/y", { method: "POST" });
    expect(r.status).toBe(403);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("forbidden");
    expect(
      (
        await app().request("/api/v1/y", {
          method: "POST",
          headers: { "x-requested-with": "querymodule" },
        })
      ).status,
    ).toBe(200);
  });
  it("Better Auth routes are exempt; /auth/embedded is not", async () => {
    expect((await app().request("/api/v1/auth/sign-in/email", { method: "POST" })).status).toBe(
      200,
    );
    expect((await app().request("/api/v1/auth/embedded", { method: "POST" })).status).toBe(403);
  });
  it("/auth/embedded stays guarded with a trailing slash, a sub-path or other case", async () => {
    for (const p of [
      "/api/v1/auth/embedded/",
      "/api/v1/auth/embedded/sub",
      "/api/v1/auth/EMBEDDED",
    ]) {
      expect((await app().request(p, { method: "POST" })).status, p).toBe(403);
    }
  });
  it("sets security headers and no-store on 403 and 413 error responses too", async () => {
    const forbidden = await app().request("/api/v1/y", { method: "POST" });
    const tooLarge = await app().request("/api/v1/y", {
      method: "POST",
      headers: { "x-requested-with": "querymodule", "content-type": "application/json" },
      body: JSON.stringify({ a: "x".repeat(33 * 1024) }),
    });
    for (const r of [forbidden, tooLarge]) {
      expect(r.headers.get("x-content-type-options"), String(r.status)).toBe("nosniff");
      expect(r.headers.get("referrer-policy"), String(r.status)).toBe("no-referrer");
      expect(r.headers.get("strict-transport-security"), String(r.status)).toBe("max-age=31536000");
      expect(r.headers.get("permissions-policy"), String(r.status)).toBe(
        "camera=(), microphone=(), geolocation=()",
      );
      expect(r.headers.get("cache-control"), String(r.status)).toBe("no-store");
    }
    expect([forbidden.status, tooLarge.status]).toEqual([403, 413]);
  });
  it("413 payloadTooLarge over 32 KB", async () => {
    const r = await app().request("/api/v1/y", {
      method: "POST",
      headers: { "x-requested-with": "querymodule", "content-type": "application/json" },
      body: JSON.stringify({ a: "x".repeat(33 * 1024) }),
    });
    expect(r.status).toBe(413);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("payloadTooLarge");
  });
  it("builds the spec 5.9 CSP", () => {
    const env = readDeployEnv(
      { PUBLIC_ORIGIN: "https://querymodule.birchdesignlab.com" },
      { configDir: "/c", migrationsDir: "/m", webDist: null },
    );
    expect(buildCsp(env, "N0nce")).toBe(
      "default-src 'self'; script-src 'nonce-N0nce' 'strict-dynamic'; style-src 'self'; connect-src 'self' wss://querymodule.birchdesignlab.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
  });
});
