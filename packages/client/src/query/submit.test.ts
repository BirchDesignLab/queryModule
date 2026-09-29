import { QueryClient } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api/create-api-client.js";
import { createFakePlatform } from "../testing/fake-platform.js";
import { buildSubmitBody, createSubmitController, type SubmitRequest } from "./submit.js";

const BASE = "http://api.test";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

const ACK = {
  correlationId: "c-1",
  acknowledgedAt: 1,
  parts: [{ partId: 0, queryType: "VEH", status: "dispatched", sourceIds: ["mock"] }],
};
const REQ: SubmitRequest = {
  queryType: "VEH",
  values: { plate: "ZZ-0001", state: "", year: null, flag: false },
  sourceIds: ["mock"],
  mode: "normal",
  configHash: "h1",
};

function setup(
  opts: {
    random?: () => number;
    platform?: ReturnType<typeof createFakePlatform>;
    delays?: number[];
  } = {},
) {
  const platform = opts.platform ?? createFakePlatform();
  const api = createApiClient({ baseUrl: BASE, platform, onUnauthenticated: () => undefined });
  const queryClient = new QueryClient();
  let n = 0;
  const controller = createSubmitController({
    api,
    queryClient,
    online: platform.online,
    newKey: () => `key-${++n}`,
    random: opts.random ?? (() => 1),
    timers: {
      setTimeout: (fn, ms) => {
        opts.delays?.push(ms);
        return globalThis.setTimeout(fn, ms);
      },
      clearTimeout: (id) => globalThis.clearTimeout(id as number),
    },
  });
  return { controller, queryClient, platform };
}

interface Seen {
  headers: Headers;
  body: unknown;
  cache: RequestCache;
}
function serveQueries(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = [];
  server.use(
    http.post(`${BASE}/api/v1/queries`, async ({ request }) => {
      seen.push({ headers: request.headers, body: await request.json(), cache: request.cache });
      return respond();
    }),
  );
  return seen;
}
const err = (code: string, extra: object = {}) => ({
  error: { code, requestId: "r", ...extra },
});

describe("FR-064 buildSubmitBody (spec 5.2 step 1)", () => {
  it("omits empty strings and nulls, keeps false", () => {
    expect(buildSubmitBody(REQ)).toEqual({
      queryType: "VEH",
      values: { plate: "ZZ-0001", flag: false },
      sourceIds: ["mock"],
      mode: "normal",
      configHash: "h1",
    });
  });
});

describe("FR-064, SEC-014 submit controller (spec 6.7)", () => {
  it("acknowledges a 202 and sends the key, CSRF header and no-store", async () => {
    const seen = serveQueries(() => HttpResponse.json(ACK, { status: 202 }));
    const { controller } = setup();
    const out = await controller.getState().submit(REQ);
    expect(out).toEqual({ kind: "acknowledged", response: ACK, queryType: "VEH" });
    expect(controller.getState().lastAck).toEqual({ response: ACK, queryType: "VEH" });
    expect(controller.getState().status).toBe("idle");
    expect(seen[0]?.headers.get("Idempotency-Key")).toBe("key-1");
    expect(seen[0]?.headers.get("X-Requested-With")).toBe("querymodule");
    expect(seen[0]?.cache).toBe("no-store");
    expect(seen[0]?.body).not.toHaveProperty("values.state");
  });

  it("409 invalidates config and gives configChanged", async () => {
    serveQueries(() => HttpResponse.json(err("configHashMismatch"), { status: 409 }));
    const { controller, queryClient } = setup();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    expect(await controller.getState().submit(REQ)).toEqual({ kind: "configChanged" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["config"] });
  });

  it("400 passes errors[] through", async () => {
    const errors = [{ key: "validation.required", params: { field: "plate" } }];
    serveQueries(() => HttpResponse.json(err("validationFailed", { errors }), { status: 400 }));
    const { controller } = setup();
    expect(await controller.getState().submit(REQ)).toEqual({ kind: "invalid", errors });
  });

  it("429 reads Retry-After", async () => {
    serveQueries(() =>
      HttpResponse.json(err("rateLimited"), { status: 429, headers: { "Retry-After": "7" } }),
    );
    const { controller } = setup();
    expect(await controller.getState().submit(REQ)).toEqual({
      kind: "rateLimited",
      retryAfterSeconds: 7,
    });
  });

  it.each([
    [403, { kind: "forbidden" }],
    [503, { kind: "unavailable" }],
    [413, { kind: "failed" }],
    [500, { kind: "failed" }],
  ])("status %i maps to its outcome", async (status, expected) => {
    serveQueries(() => HttpResponse.json(err("internal"), { status }));
    const { controller } = setup();
    expect(await controller.getState().submit(REQ)).toEqual(expected);
  });

  it("a network failure gives noResponse and noConnection; the key is reused for an identical body only", async () => {
    server.use(http.get(`${BASE}/api/v1/health`, () => HttpResponse.error()));
    const seen = serveQueries(() => HttpResponse.error());
    const { controller } = setup();
    expect(await controller.getState().submit(REQ)).toEqual({ kind: "noResponse" });
    expect(controller.getState().status).toBe("noConnection");
    await controller.getState().submit({ ...REQ, values: { ...REQ.values } });
    await controller.getState().submit({ ...REQ, values: { plate: "ZZ-0002" } });
    expect(seen.map((s) => s.headers.get("Idempotency-Key"))).toEqual(["key-1", "key-1", "key-2"]);
  });

  it("any response discards the kept key", async () => {
    let fail = true;
    const seen = serveQueries(() =>
      fail ? HttpResponse.error() : HttpResponse.json(ACK, { status: 202 }),
    );
    server.use(http.get(`${BASE}/api/v1/health`, () => HttpResponse.error()));
    const { controller } = setup();
    await controller.getState().submit(REQ);
    fail = false;
    await controller.getState().submit(REQ);
    await controller.getState().submit(REQ);
    expect(seen.map((s) => s.headers.get("Idempotency-Key"))).toEqual(["key-1", "key-1", "key-2"]);
  });

  it("polls health with jittered backoff until it answers, then idle", async () => {
    const delays: number[] = [];
    serveQueries(() => HttpResponse.error());
    let health = 0;
    const backgrounds: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/api/v1/health`, ({ request }) => {
        backgrounds.push(request.headers.get("X-Background"));
        health += 1;
        return health <= 2 ? HttpResponse.error() : HttpResponse.json({ status: "ok" });
      }),
    );
    const { controller } = setup({ random: () => 0.5, delays });
    await controller.getState().submit(REQ);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(health).toBe(3);
    expect(controller.getState().status).toBe("idle");
    expect(backgrounds).toEqual(["1", "1", "1"]);
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it("goes noConnection when the platform reports offline", () => {
    const platform = createFakePlatform();
    server.use(http.get(`${BASE}/api/v1/health`, () => HttpResponse.error()));
    const { controller } = setup({ platform });
    platform.setOnline(false);
    expect(controller.getState().status).toBe("noConnection");
  });

  it("ignores a second submit while submitting and returns the same promise", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const seen = serveQueries(async () => {
      await gate;
      return HttpResponse.json(ACK, { status: 202 });
    });
    const { controller } = setup();
    const a = controller.getState().submit(REQ);
    const b = controller.getState().submit(REQ);
    expect(controller.getState().status).toBe("submitting");
    release();
    expect(await b).toEqual(await a);
    expect(seen).toHaveLength(1);
  });

  it("reset clears lastAck, the kept key and the health timer", async () => {
    const seen = serveQueries(() => HttpResponse.error());
    let health = 0;
    server.use(
      http.get(`${BASE}/api/v1/health`, () => {
        health += 1;
        return HttpResponse.error();
      }),
    );
    const { controller } = setup();
    await controller.getState().submit(REQ);
    controller.getState().reset();
    expect(controller.getState().status).toBe("idle");
    expect(controller.getState().lastAck).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(health).toBe(0);
    await controller.getState().submit(REQ);
    expect(seen.map((s) => s.headers.get("Idempotency-Key"))).toEqual(["key-1", "key-2"]);
  });

  it("a response arriving after reset does not set lastAck", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    serveQueries(async () => {
      await gate;
      return HttpResponse.json(ACK, { status: 202 });
    });
    const { controller } = setup();
    const p = controller.getState().submit(REQ);
    controller.getState().reset();
    release();
    await p;
    expect(controller.getState().lastAck).toBeNull();
    expect(controller.getState().status).toBe("idle");
  });
});
