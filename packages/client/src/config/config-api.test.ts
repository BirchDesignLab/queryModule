import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SiteConfigSchema, toClientSiteConfig } from "@querymodule/core/config";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api/create-api-client.js";
import { noTokenStore } from "../platform.js";
import { ConfigFetchError, clientConfigQuery, fetchClientConfig } from "./config-api.js";

const BASE = "http://api.test";
const HASH = "0000000000000000000000000000000000000000000000000000000000000001";
const defaultPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../config/sites/default.json",
);
const CONFIG = toClientSiteConfig(
  SiteConfigSchema.parse(JSON.parse(readFileSync(defaultPath, "utf8"))),
  HASH,
);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeApi(onUnauthenticated: () => void = () => undefined) {
  return createApiClient({
    baseUrl: BASE,
    platform: { authTransport: "cookie", tokenStore: noTokenStore } as never,
    onUnauthenticated,
  });
}
const serve = (respond: () => Response) => server.use(http.get(`${BASE}/api/v1/config`, respond));

describe("BR-001 client config (spec 4.1 client view, 6.7)", () => {
  it("parses a 200 body and returns the config", async () => {
    serve(() => HttpResponse.json(CONFIG));
    await expect(fetchClientConfig(makeApi())).resolves.toEqual(CONFIG);
  });

  it("strips an unknown top-level key from a newer server", async () => {
    serve(() => HttpResponse.json({ ...CONFIG, futureThing: { a: 1 } }));
    const got = await fetchClientConfig(makeApi());
    expect(got).toEqual(CONFIG);
    expect("futureThing" in got).toBe(false);
  });

  it("strips an unknown feature key from a newer server", async () => {
    serve(() =>
      HttpResponse.json({ ...CONFIG, features: { ...CONFIG.features, futureFlag: true } }),
    );
    const got = await fetchClientConfig(makeApi());
    expect("futureFlag" in got.features).toBe(false);
  });

  it("catches an unknown optional enum value from a newer server", async () => {
    serve(() =>
      HttpResponse.json({
        ...CONFIG,
        queryTypes: CONFIG.queryTypes.map((q) => ({
          ...q,
          fields: q.fields.map((fd) => ({ ...fd, role: "futureRole" })),
        })),
      }),
    );
    const got = await fetchClientConfig(makeApi());
    expect(got.queryTypes[0]?.fields[0]?.role).toBeUndefined();
  });

  it("a 401 calls onUnauthenticated and rejects with ConfigFetchError", async () => {
    serve(() => HttpResponse.json({ key: "auth.required", params: {} }, { status: 401 }));
    const onUnauthenticated = vi.fn();
    await expect(fetchClientConfig(makeApi(onUnauthenticated))).rejects.toBeInstanceOf(
      ConfigFetchError,
    );
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("a malformed body rejects with ConfigFetchError that carries no body text", async () => {
    serve(() => HttpResponse.json({ secret: "SENTINEL-BODY-TEXT", schemaVersion: 1 }));
    const err = await fetchClientConfig(makeApi()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigFetchError);
    expect((err as Error).message).not.toContain("SENTINEL-BODY-TEXT");
  });

  it("a non-JSON 200 body rejects with ConfigFetchError", async () => {
    serve(() => new HttpResponse("SENTINEL-BODY-TEXT", { status: 200 }));
    const err = await fetchClientConfig(makeApi()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigFetchError);
    expect((err as Error).message).not.toContain("SENTINEL-BODY-TEXT");
  });

  it("a 503 rejects with ConfigFetchError naming only the status", async () => {
    serve(() => new HttpResponse("SENTINEL-BODY-TEXT", { status: 503 }));
    const err = await fetchClientConfig(makeApi()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigFetchError);
    expect((err as Error).message).toContain("503");
  });

  it("clientConfigQuery keys on config and never goes stale", async () => {
    serve(() => HttpResponse.json(CONFIG));
    const q = clientConfigQuery(makeApi());
    expect(q.queryKey).toEqual(["config"]);
    expect(q.staleTime).toBe(Number.POSITIVE_INFINITY);
    await expect(q.queryFn()).resolves.toEqual(CONFIG);
  });
});
