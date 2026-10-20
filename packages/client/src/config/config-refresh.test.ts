import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ClientSiteConfigResponse,
  SiteConfigSchema,
  toClientSiteConfig,
} from "@querymodule/core/config";
import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api/create-api-client.js";
import { createFakePlatform } from "../testing/fake-platform.js";
import { createConfigRefresh } from "./config-refresh.js";

const BASE = "http://api.test";
const hash = (n: number): string => String(n).padStart(64, "0");
const site = SiteConfigSchema.parse(
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../config/sites/default.json"),
      "utf8",
    ),
  ),
);
/** A fixed UUIDv7 per published version: `v` is the version, independent of the hash. */
const versionIdOf = (v: number): string => `01890a5d-ac96-7000-8000-${String(v).padStart(12, "0")}`;
const configOf = (n: number, v = n): ClientSiteConfigResponse => ({
  ...toClientSiteConfig(site, hash(n)),
  versionId: versionIdOf(v),
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

interface Served {
  backgrounds: (string | null)[];
  hashes: number[];
}
/** Serves GET /api/v1/config; `current` decides which config the server holds right now. */
function serveConfig(state: {
  n: number;
  v?: number;
  fail?: boolean;
  gate?: Promise<void>;
}): Served {
  const served: Served = { backgrounds: [], hashes: [] };
  server.use(
    http.get(`${BASE}/api/v1/config`, async ({ request }) => {
      served.backgrounds.push(request.headers.get("X-Background"));
      served.hashes.push(state.n);
      if (state.gate !== undefined) await state.gate;
      if (state.fail === true) return HttpResponse.error();
      return HttpResponse.json(configOf(state.n, state.v));
    }),
  );
  return served;
}

function setup(n = 1) {
  const platform = createFakePlatform();
  const api = createApiClient({ baseUrl: BASE, platform, onUnauthenticated: () => undefined });
  const queryClient = new QueryClient();
  queryClient.setQueryData(["config"], configOf(n));
  const refresh = createConfigRefresh({ api, queryClient, platform, intervalMs: 15_000 });
  return { platform, queryClient, refresh };
}
const cached = (qc: QueryClient) => qc.getQueryData<ClientSiteConfigResponse>(["config"]);

describe("ADR-0011 item 3 live config refresh (#361)", () => {
  it("a same hash changes nothing: the cached object stays", async () => {
    const state = { n: 1 };
    const served = serveConfig(state);
    const { queryClient, refresh } = setup(1);
    const before = cached(queryClient);
    refresh.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(served.hashes).toHaveLength(1);
    expect(cached(queryClient)).toBe(before);
    refresh.stop();
  });

  it("a new hash after 15 s replaces the cached config", async () => {
    const state = { n: 1 };
    serveConfig(state);
    const { queryClient, refresh } = setup(1);
    refresh.start();
    state.n = 2;
    await vi.advanceTimersByTimeAsync(14_999);
    expect(cached(queryClient)?.configHash).toBe(hash(1));
    await vi.advanceTimersByTimeAsync(1);
    expect(cached(queryClient)?.configHash).toBe(hash(2));
    refresh.stop();
  });

  // #46 CFG-1, D-M2P3-5: a label-only publish keeps configHash (CFG-3) and changes versionId.
  it("a new versionId with the same hash replaces the cached config", async () => {
    const state = { n: 1, v: 1 };
    serveConfig(state);
    const { queryClient, refresh } = setup(1);
    refresh.start();
    state.v = 2;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(cached(queryClient)?.configHash).toBe(hash(1));
    expect(cached(queryClient)?.versionId).toBe(versionIdOf(2));
    refresh.stop();
  });

  it("the same hash and versionId leave the cached object in place", async () => {
    const state = { n: 1, v: 1 };
    const served = serveConfig(state);
    const { queryClient, refresh } = setup(1);
    const before = cached(queryClient);
    refresh.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(served.hashes).toHaveLength(1);
    expect(cached(queryClient)).toBe(before);
    refresh.stop();
  });

  it("keeps refreshing every 15 s, each request marked as background", async () => {
    const state = { n: 1 };
    const served = serveConfig(state);
    const { refresh } = setup(1);
    refresh.start();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(served.hashes).toHaveLength(3);
    expect(served.backgrounds).toEqual(["1", "1", "1"]);
    refresh.stop();
  });

  it("becoming visible refetches at once and restarts the interval", async () => {
    const state = { n: 1 };
    const served = serveConfig(state);
    const { platform, queryClient, refresh } = setup(1);
    refresh.start();
    platform.setVisible(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(served.hashes).toHaveLength(0);
    state.n = 2;
    platform.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(cached(queryClient)?.configHash).toBe(hash(2));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(served.hashes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(served.hashes).toHaveLength(2);
    refresh.stop();
  });

  it("stop ends the timer and unsubscribes: no request afterwards", async () => {
    const state = { n: 1 };
    const served = serveConfig(state);
    const { platform, refresh } = setup(1);
    refresh.start();
    refresh.stop();
    platform.setVisible(false);
    platform.setVisible(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(served.hashes).toHaveLength(0);
  });

  it("an answer that arrives after stop is dropped", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const state = { n: 2, gate };
    serveConfig(state);
    const { queryClient, refresh } = setup(1);
    refresh.start();
    await vi.advanceTimersByTimeAsync(15_000);
    refresh.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(cached(queryClient)?.configHash).toBe(hash(1));
  });

  it("a failed refresh keeps the config, is silent, and the next interval tries again", async () => {
    const state = { n: 2, fail: true };
    const served = serveConfig(state);
    const { queryClient, refresh } = setup(1);
    refresh.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(cached(queryClient)?.configHash).toBe(hash(1));
    state.fail = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(served.hashes).toHaveLength(2);
    expect(cached(queryClient)?.configHash).toBe(hash(2));
    refresh.stop();
  });

  it("a 401 that ends the session (onUnauthenticated stops the refresh) leaves no further request", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/api/v1/config`, () => {
        calls += 1;
        return new HttpResponse(null, { status: 401 });
      }),
    );
    const platform = createFakePlatform();
    const queryClient = new QueryClient();
    queryClient.setQueryData(["config"], configOf(1));
    // eslint-style forward reference: the app's reset stops the refresh before the 401 answer resolves.
    const holder: { refresh?: ReturnType<typeof createConfigRefresh> } = {};
    const api = createApiClient({
      baseUrl: BASE,
      platform,
      onUnauthenticated: () => holder.refresh?.stop(),
    });
    holder.refresh = createConfigRefresh({ api, queryClient, platform, intervalMs: 15_000 });
    holder.refresh.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(1);
    expect(cached(queryClient)?.configHash).toBe(hash(1));
  });

  it("restores a config the query cache dropped (gcTime) with the same hash", async () => {
    const state = { n: 1 };
    serveConfig(state);
    const { queryClient, refresh } = setup(1);
    queryClient.removeQueries({ queryKey: ["config"] });
    refresh.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(cached(queryClient)?.configHash).toBe(hash(1));
    refresh.stop();
  });

  it("never runs two requests at once", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const state = { n: 1, gate };
    const served = serveConfig(state);
    const { platform, refresh } = setup(1);
    refresh.start();
    await vi.advanceTimersByTimeAsync(15_000);
    platform.setVisible(false);
    platform.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(served.hashes).toHaveLength(1);
    release();
    refresh.stop();
  });

  it("start twice runs one chain", async () => {
    const state = { n: 1 };
    const served = serveConfig(state);
    const { refresh } = setup(1);
    refresh.start();
    refresh.start();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(served.hashes).toHaveLength(1);
    refresh.stop();
  });
});
