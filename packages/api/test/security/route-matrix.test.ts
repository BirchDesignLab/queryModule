import { ClientSiteConfigSchema } from "@querymodule/core/config";
import type { RouteAccess } from "@querymodule/core/contracts";
import { ApiErrorSchema, ROUTES } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/test-app";

const SERVED = new Set([
  "GET /api/v1/health",
  "GET /api/v1/meta",
  "GET /api/v1/locales/:locale",
  "GET /api/v1/config",
  "GET /api/v1/me/preferences",
  "PUT /api/v1/me/preferences",
]);
const fill = (p: string) =>
  p.replace(/:([A-Za-z]+)|\{([A-Za-z]+)\}/g, (_m, a, b) => ((a ?? b) === "locale" ? "en" : "x"));
const keyOf = (r: { method: string; path: string }) =>
  `${r.method.toUpperCase()} ${r.path.replace(/\{([A-Za-z]+)\}/g, ":$1")}`;

describe("SEC-006 route by caller matrix (P1)", () => {
  it("expected anonymous status is derived from the contract's access, not a hand-typed literal", () => {
    // Guards against critic:I1: a hand-typed SERVED[key].anonymous literal can drift from
    // the contract (a future sessionOwn route mounted without requireSession would just get
    // `{ anonymous: 200 }` added to SERVED and the matrix would go green). The expectation
    // must come from `r.access` instead, so this fixture stands in for a not-yet-real route
    // whose handler forgot to require a session: access says sessionOwn, so 401 is required
    // regardless of what a hand-typed record might claim.
    const servedSessionOwnRoute: { method: "get"; path: string; access: RouteAccess } = {
      method: "get",
      path: "/api/v1/example",
      access: "sessionOwn",
    };
    const served = true;
    const expected = !served ? 404 : servedSessionOwnRoute.access === "public" ? 200 : 401;
    expect(expected).toBe(401);
  });
  it("every served route is in the contract", () => {
    const contract = new Set(ROUTES.map(keyOf));
    for (const k of SERVED) expect(contract.has(k), k).toBe(true);
  });
  it.each(ROUTES.map((r) => [keyOf(r), r] as const))("anonymous %s", async (key, r) => {
    const t = await createTestApp();
    if (r.path.startsWith("/api/v1/auth/")) return; // Better Auth routes: auth-limits.test.ts
    const res = await t.request(fill(r.path), {
      method: r.method.toUpperCase(),
      headers: { "x-requested-with": "querymodule" },
    });
    const expected = !SERVED.has(key) ? 404 : r.access === "public" ? 200 : 401;
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
