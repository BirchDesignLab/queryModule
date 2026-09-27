import { describe, expect, it, vi } from "vitest";
import type { ClientPlatform, PlatformSignal, TokenStore } from "../platform.js";
import { applyRequestHeaders, createApiClient, REQUESTED_WITH } from "./create-api-client.js";

const META = {
  apiVersion: "v1",
  coreVersion: "0.1.0",
  configSchemaVersion: 1,
  configHash: "0000000000000000000000000000000000000000000000000000000000000001",
  minClientVersion: null,
};

function alwaysOn(): PlatformSignal {
  return { current: () => true, subscribe: () => () => undefined };
}

function platform(
  authTransport: "cookie" | "bearer",
  tokenStore: TokenStore | null = null,
): ClientPlatform {
  return { authTransport, tokenStore, online: alwaysOn(), visible: alwaysOn() };
}

describe("SEC-007 request headers (spec 5.9)", () => {
  it("adds X-Requested-With to state-changing methods only", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const request = await applyRequestHeaders(
        new Request("http://api.test/api/v1/x", { method }),
        platform("cookie"),
      );
      expect(request.headers.get("x-requested-with")).toBe(REQUESTED_WITH);
    }
    const get = await applyRequestHeaders(
      new Request("http://api.test/api/v1/x"),
      platform("cookie"),
    );
    expect(get.headers.get("x-requested-with")).toBeNull();
  });
  it("sends the bearer token only for bearer platforms", async () => {
    const store: TokenStore = {
      get: async () => "token-for-test",
      set: async () => undefined,
      clear: async () => undefined,
    };
    const bearer = await applyRequestHeaders(
      new Request("http://api.test/a"),
      platform("bearer", store),
    );
    expect(bearer.headers.get("authorization")).toBe("Bearer token-for-test");
    const cookie = await applyRequestHeaders(
      new Request("http://api.test/a"),
      platform("cookie", store),
    );
    expect(cookie.headers.get("authorization")).toBeNull();
  });
});

describe("SEC-006 typed client respects no-store and resets on 401 (spec 6.7)", () => {
  it("GETs with cache no-store and cookie credentials", async () => {
    const seen: Request[] = [];
    const api = createApiClient({
      baseUrl: "http://api.test",
      platform: platform("cookie"),
      onUnauthenticated: () => undefined,
      fetch: async (request) => {
        seen.push(request);
        return Response.json(META);
      },
    });
    const { data } = await api.GET("/api/v1/meta");
    expect(data).toEqual(META);
    expect(seen[0]?.url).toBe("http://api.test/api/v1/meta");
    expect(seen[0]?.cache).toBe("no-store");
    expect(seen[0]?.credentials).toBe("include");
  });
  it("calls onUnauthenticated on 401", async () => {
    const onUnauthenticated = vi.fn();
    const api = createApiClient({
      baseUrl: "http://api.test",
      platform: platform("cookie"),
      onUnauthenticated,
      fetch: async () =>
        Response.json({ error: { code: "unauthenticated", requestId: "r1" } }, { status: 401 }),
    });
    await api.GET("/api/v1/meta");
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });
});
