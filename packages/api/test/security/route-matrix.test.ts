import { ClientSiteConfigSchema } from "@querymodule/core/config";
import { ApiErrorSchema, ROUTES } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/test-app";

const SERVED: Record<string, { anonymous: number }> = {
  "GET /api/v1/health": { anonymous: 200 },
  "GET /api/v1/meta": { anonymous: 200 },
  "GET /api/v1/locales/:locale": { anonymous: 200 },
  "GET /api/v1/config": { anonymous: 401 },
  "GET /api/v1/me/preferences": { anonymous: 401 },
  "PUT /api/v1/me/preferences": { anonymous: 401 },
};
const fill = (p: string) =>
  p.replace(/:([A-Za-z]+)|\{([A-Za-z]+)\}/g, (_m, a, b) => ((a ?? b) === "locale" ? "en" : "x"));
const keyOf = (r: { method: string; path: string }) =>
  `${r.method.toUpperCase()} ${r.path.replace(/\{([A-Za-z]+)\}/g, ":$1")}`;

describe("SEC-006 route by caller matrix (P1)", () => {
  it("every served route is in the contract", () => {
    const contract = new Set(ROUTES.map(keyOf));
    for (const k of Object.keys(SERVED)) expect(contract.has(k), k).toBe(true);
  });
  it.each(ROUTES.map((r) => [keyOf(r), r] as const))("anonymous %s", async (key, r) => {
    const t = await createTestApp();
    if (r.path.startsWith("/api/v1/auth/")) return; // Better Auth routes: auth-limits.test.ts
    const res = await t.request(fill(r.path), {
      method: r.method.toUpperCase(),
      headers: { "x-requested-with": "querymodule" },
    });
    const expected = SERVED[key]?.anonymous ?? 404;
    expect(res.status).toBe(expected);
    if (expected >= 400) {
      const code = ApiErrorSchema.parse(await res.json()).error.code;
      expect(code).toBe(expected === 401 ? "unauthenticated" : "notFound");
    }
  });
  it("GET /api/v1/config: 401 anonymous; with a session the body is the allowlist", async () => {
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", "correct-horse-battery-1");
    const cookie = await t.cookieFor("dispatcher@example.test", "correct-horse-battery-1");
    const body = await (await t.request("/api/v1/config", { headers: { cookie } })).json();
    expect(ClientSiteConfigSchema.strict().safeParse(body).success).toBe(true);
  });
  it("missing X-Requested-With on a state-changing route is 403 forbidden", async () => {
    const t = await createTestApp();
    const r = await t.request("/api/v1/meta", { method: "POST" });
    expect(r.status).toBe(403);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("forbidden");
  });
});
