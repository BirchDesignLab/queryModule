import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ClientSiteConfig,
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
const configOf = (n: number): ClientSiteConfig => toClientSiteConfig(site, hash(n));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

interface Served {
  backgrounds: (string | null)[];
  hashes: number[];
}
/** Serves GET /api/v1/config; `current` decides which config the server holds right now. */
function serveConfig(state: { n: number; fail?: boolean; gate?: Promise<void> }): Served {
  const served: Served = { backgrounds: [], hashes: [] };
  server.use(
    http.get(`${BASE}/api/v1/config`, async ({ request }) => {
      served.backgrounds.push(request.headers.get("X-Background"));
      served.hashes.push(state.n);
      if (state.gate !== undefined) await state.gate;
      if (state.fail === true) return HttpResponse.error();
      return HttpResponse.json(configOf(state.n));
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
const cached = (qc: QueryClient) => qc.getQueryData<ClientSiteConfig>(["config"]);

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
