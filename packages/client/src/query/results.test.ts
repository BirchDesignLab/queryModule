import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../api/create-api-client.js";
import type { components } from "../api/generated/openapi-types.js";
import type { SourceStatusEvent } from "../feed/feed-socket.js";
import { createFakePlatform } from "../testing/fake-platform.js";
import { createRequestsStore, type RequestEntry } from "./requests.js";
import { createResultFetcher } from "./results.js";
import type { SubmitQueryResponse } from "./submit.js";

const BASE = "http://api.test";
const CORRELATION = "01923abc-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
const fetchers: { reset(): void }[] = [];
afterEach(() => {
  for (const fetcher of fetchers.splice(0)) fetcher.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Detail = components["schemas"]["getQuery200"];
type DetailSource = Detail["parts"][number]["sources"][number];

const ACK: SubmitQueryResponse = {
  correlationId: CORRELATION,
  acknowledgedAt: 1_780_000_000_000,
  parts: [
    {
      partId: 1,
      parentPartId: null,
      origin: "primary",
      queryType: "VEH",
      status: "dispatched",
      sourceIds: ["state", "national"],
      droppedSourceIds: [],
      skipReasons: [],
    },
  ],
};

const source = (
  sourceId: string,
  status: DetailSource["status"],
  payload?: Record<string, unknown>,
): DetailSource => ({
  resultId: `res-${sourceId}`,
  sourceId,
  status,
  adapterKind: "mock",
  errorCode: null,
  createdAt: 1,
  receivedAt: status === "pending" ? null : 2,
  timedOutAt: null,
  purged: false,
  ...(payload === undefined ? {} : { payload }),
});

function detailOf(
  sources: DetailSource[],
  partOverrides: Partial<Detail["parts"][number]> = {},
): Detail {
  return {
    correlationId: CORRELATION,
    submittedAt: 1_780_000_000_000,
    configHash: "h1",
    parts: [
      {
        partId: 1,
        parentPartId: null,
        origin: "primary",
        queryType: "VEH",
        typeValues: {},
        plateOnly: false,
        skipReasons: [],
        droppedSourceIds: [],
        purged: false,
        sources,
        ...partOverrides,
      },
    ],
  };
}

const event = (
  seq: number,
  sourceId: string,
  status: SourceStatusEvent["status"],
): SourceStatusEvent =>
  ({
    v: 1,
    type: "sourceStatus",
    seq,
    at: 1_780_000_001_000,
    correlationId: CORRELATION,
    partId: 1,
    sourceId,
    resultId: `res-${sourceId}`,
    status,
  }) as SourceStatusEvent;

function setup(
  opts: { acknowledged?: boolean; fetch?: (request: Request) => Promise<Response> } = {},
) {
  const platform = createFakePlatform();
  const api = createApiClient({
    baseUrl: BASE,
    platform,
    onUnauthenticated: () => undefined,
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
  });
  const timers = {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: unknown) => globalThis.clearTimeout(id as number),
  };
  const store = createRequestsStore({ timers });
  if (opts.acknowledged !== false) {
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    store.getState().settle(id, { kind: "acknowledged", response: ACK, queryType: "VEH" });
  }
  const fetcher = createResultFetcher({ api, timers, store, random: () => 1 });
  fetchers.push(fetcher);
  const entry = (): Extract<RequestEntry, { status: "acknowledged" }> => {
    const found = store.getState().items.find((item) => item.status === "acknowledged");
    if (found?.status !== "acknowledged") throw new Error("not acknowledged");
    return found;
  };
  const apply = (e: SourceStatusEvent): void => {
    store.getState().applyEvent(e);
    fetcher.handleEvent(e);
  };
  return { store, fetcher, entry, apply };
}

/** Advances the fake clock, then yields to real I/O so MSW's answer lands before the next assertion. */
async function pass(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await vi.advanceTimersByTimeAsync(0);
}

/** Serves the detail and records each request's headers. */
function serve(responder: () => Response | Promise<Response>) {
  const calls: Headers[] = [];
  server.use(
    http.get(`${BASE}/api/v1/queries/:id`, ({ request }) => {
      calls.push(request.headers);
      return responder();
    }),
  );
  return calls;
}

const payloadsOf = (item: RequestEntry | undefined) =>
  item?.status === "acknowledged"
    ? item.parts[0]?.sources.map((s) => s.result?.payload)
    : undefined;

describe("FR-043 fetch result payloads when sources settle (spec 6.7)", () => {
  it("two returned events within the window cause one fetch that fills both payloads", async () => {
    const calls = serve(() =>
      HttpResponse.json(
        detailOf([source("state", "returned", { a: 1 }), source("national", "returned", { b: 2 })]),
      ),
    );
    const { apply, entry } = setup();
    apply(event(1, "state", "returned"));
    apply(event(2, "national", "returned"));
    await pass(2000);
    expect(calls).toHaveLength(1);
    expect(payloadsOf(entry())).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("sends X-Background: 1 so the fetch does not count as user activity", async () => {
    const calls = serve(() => HttpResponse.json(detailOf([source("state", "returned", { a: 1 })])));
    const { apply } = setup();
    apply(event(1, "state", "returned"));
    await pass(2000);
    expect(calls[0]?.get("x-background")).toBe("1");
  });

  it("an event after a fetch settles gets its own trailing fetch", async () => {
    let n = 0;
    const calls = serve(() => {
      n += 1;
      return HttpResponse.json(
        detailOf(
          n === 1
            ? [source("state", "returned", { a: 1 }), source("national", "pending")]
            : [source("state", "returned", { a: 1 }), source("national", "returned", { b: 2 })],
        ),
      );
    });
    const { apply, entry } = setup();
    apply(event(1, "state", "returned"));
    await pass(2000);
    apply(event(2, "national", "returned"));
    await pass(2000);
    expect(calls).toHaveLength(2);
    expect(payloadsOf(entry())).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("an event for an unknown correlation ID creates a placeholder the fetch fills (spec 6.7)", async () => {
    serve(() =>
      HttpResponse.json(
        detailOf([source("state", "returned", { a: 1 }), source("national", "pending")], {
          origin: "alsoRun",
          parentPartId: 0,
          skipReasons: [{ key: "validation.required", params: { field: "dob" } }],
        }),
      ),
    );
    const { apply, entry, store } = setup({ acknowledged: false });
    apply(event(1, "state", "returned"));
    expect(store.getState().items).toHaveLength(0);
    await pass(2000);
    const part = entry().parts[0];
    expect(entry().correlationId).toBe(CORRELATION);
    expect(entry().queryType).toBe("VEH");
    expect(part?.origin).toBe("alsoRun");
    expect(part?.parentPartId).toBe(0);
    expect(part?.skipReasons).toEqual([{ key: "validation.required", params: { field: "dob" } }]);
    expect(part?.sources.map((s) => [s.status, s.result?.payload])).toEqual([
      ["returned", { a: 1 }],
      ["pending", undefined],
    ]);
  });

  it("statuses never move backwards: a stale detail cannot reopen a settled source", async () => {
    serve(() =>
      HttpResponse.json(detailOf([source("state", "pending"), source("national", "pending")])),
    );
    const { apply, entry, store } = setup();
    store.getState().applyEvent(event(1, "state", "failed"));
    apply(event(2, "national", "returned"));
    await pass(2000);
    expect(entry().parts[0]?.sources.map((s) => s.status)).toEqual(["failed", "returned"]);
  });

  it("a 404 drops the fetch quietly and does not retry", async () => {
    const calls = serve(() => HttpResponse.json({ error: { code: "notFound" } }, { status: 404 }));
    const { apply, entry } = setup();
    apply(event(1, "state", "returned"));
    await pass(120_000);
    expect(calls).toHaveLength(1);
    expect(entry().parts[0]?.sources[0]?.result).toBeUndefined();
  });

  it("a network failure retries on backoff while a source is pending, then fills", async () => {
    let n = 0;
    const calls = serve(() => {
      n += 1;
      return n === 1
        ? HttpResponse.error()
        : HttpResponse.json(
            detailOf([source("state", "returned", { a: 1 }), source("national", "pending")]),
          );
    });
    const { apply, entry } = setup();
    apply(event(1, "state", "returned"));
    await pass(500);
    expect(calls).toHaveLength(1);
    await pass(5000);
    expect(calls).toHaveLength(2);
    expect(payloadsOf(entry())).toEqual([{ a: 1 }, undefined]);
  });

  it("a failed fetch retries when the only source is returned and has no payload", async () => {
    let n = 0;
    const calls = serve(() => {
      n += 1;
      return n === 1
        ? HttpResponse.error()
        : HttpResponse.json(detailOf([source("state", "returned", { a: 1 })]));
    });
    const { apply, entry, store } = setup();
    store.getState().applyEvent(event(1, "national", "failed"));
    apply(event(2, "state", "returned"));
    await pass(500);
    expect(calls).toHaveLength(1);
    await pass(5000);
    expect(calls).toHaveLength(2);
    expect(entry().parts[0]?.sources[0]?.result?.payload).toEqual({ a: 1 });
  });

  it("a network failure stops retrying once every returned source has its payload", async () => {
    let n = 0;
    const calls = serve(() => {
      n += 1;
      return n === 1
        ? HttpResponse.json(detailOf([source("state", "returned", { a: 1 })]))
        : HttpResponse.error();
    });
    const { apply, store } = setup();
    store.getState().applyEvent(event(1, "national", "failed"));
    apply(event(2, "state", "returned"));
    await pass(500);
    expect(calls).toHaveLength(1);
    apply(event(3, "state", "returned"));
    await pass(500);
    expect(calls).toHaveLength(2);
    await pass(300_000);
    expect(calls).toHaveLength(2);
  });

  it("C2 a retry settled once keeps the user's row over a placeholder for the same request", async () => {
    serve(() =>
      HttpResponse.json(
        detailOf([source("state", "returned", { a: 1 }), source("national", "pending")]),
      ),
    );
    const { store, apply } = setup({ acknowledged: false });
    apply(event(1, "state", "returned"));
    await pass(2000);
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    store
      .getState()
      .settle(id, { kind: "acknowledged", response: ACK, queryType: "VEH" }, { once: true });
    const rows = store.getState().items;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.summary).toBe("VEH.ZZ-0001");
    expect(rows[0]?.status === "acknowledged" && rows[0].placeholder).toBeFalsy();
  });

  it("events that outran the 202 fetch once the request is acknowledged", async () => {
    const calls = serve(() =>
      HttpResponse.json(
        detailOf([source("state", "returned", { a: 1 }), source("national", "pending")]),
      ),
    );
    const { store } = setup({ acknowledged: false });
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    store.getState().applyEvent(event(1, "state", "returned"));
    store.getState().settle(id, { kind: "acknowledged", response: ACK, queryType: "VEH" });
    await pass(2000);
    expect(calls).toHaveLength(1);
    expect(payloadsOf(store.getState().items[0])).toEqual([{ a: 1 }, undefined]);
  });

  it("a placeholder is replaced by the 202 without a duplicate row", async () => {
    serve(() =>
      HttpResponse.json(
        detailOf([source("state", "returned", { a: 1 }), source("national", "pending")]),
      ),
    );
    const { store, apply } = setup({ acknowledged: false });
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    apply(event(1, "state", "returned"));
    await pass(2000);
    expect(store.getState().items).toHaveLength(2);
    store.getState().settle(id, { kind: "acknowledged", response: ACK, queryType: "VEH" });
    const items = store.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toBe("VEH.ZZ-0001");
    expect(payloadsOf(items[0])).toEqual([{ a: 1 }, undefined]);
  });
});

describe("spec 6.7 payloads are memory only and cleared on reset", () => {
  it("reset cancels a fetch in flight and clears payloads", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = serve(async () => {
      await gate;
      return HttpResponse.json(detailOf([source("state", "returned", { a: 1 })]));
    });
    const { apply, store, fetcher } = setup();
    apply(event(1, "state", "returned"));
    await pass(2000);
    expect(calls).toHaveLength(1);
    store.getState().reset();
    fetcher.reset();
    release();
    await pass(2000);
    expect(store.getState().items).toHaveLength(0);
  });

  it("reset cancels a scheduled fetch and a pending retry", async () => {
    const calls = serve(() => HttpResponse.error());
    const { apply, store, fetcher } = setup();
    apply(event(1, "state", "returned"));
    await pass(500);
    expect(calls).toHaveLength(1);
    store.getState().reset();
    fetcher.reset();
    await pass(300_000);
    expect(calls).toHaveLength(1);
  });

  it("writes nothing to localStorage or sessionStorage", async () => {
    const setItem = vi.fn();
    const stub = { setItem, getItem: () => null, removeItem: vi.fn(), clear: vi.fn() };
    vi.stubGlobal("localStorage", stub);
    vi.stubGlobal("sessionStorage", stub);
    serve(() => HttpResponse.json(detailOf([source("state", "returned", { a: 1 })])));
    const { apply } = setup();
    apply(event(1, "state", "returned"));
    await pass(2000);
    expect(setItem).not.toHaveBeenCalled();
  });
});

const idOf = (n: number): string => `01923abc-c3d4-7e5f-8a9b-${n.toString().padStart(12, "0")}`;
/** A request other than the canned one, as the list and the detail answer it (mock data only). */
const requestOf = (n: number, sources: DetailSource[]): Detail => ({
  ...detailOf(sources),
  correlationId: idOf(n),
  submittedAt: 1_780_000_000_000 + n * 1000,
});
const eventFor = (n: number, seq: number, sourceId: string): SourceStatusEvent => ({
  ...event(seq, sourceId, "returned"),
  correlationId: idOf(n),
});

/** Serves the list and records each call's URL and headers. */
function serveList(responder: () => Response | Promise<Response>) {
  const calls: { url: URL; headers: Headers }[] = [];
  server.use(
    http.get(`${BASE}/api/v1/queries`, ({ request }) => {
      calls.push({ url: new URL(request.url), headers: request.headers });
      return responder();
    }),
  );
  return calls;
}
const listOf = (requests: Detail[]) => HttpResponse.json({ requests, nextCursor: null });

describe("FR-065 list load (spec 6.7, 6.8)", () => {
  it("GET /queries?limit=50 as a background call, merged into the store as rows", async () => {
    const calls = serveList(() =>
      listOf([
        requestOf(2, [source("state", "pending"), source("national", "pending")]),
        requestOf(1, [source("state", "pending"), source("national", "pending")]),
      ]),
    );
    const { fetcher, store } = setup({ acknowledged: false });
    await fetcher.loadList();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get("limit")).toBe("50");
    expect(calls[0]?.headers.get("x-background")).toBe("1");
    const rows = store.getState().items;
    expect(rows.map((r) => r.status === "acknowledged" && r.correlationId)).toEqual([
      idOf(2),
      idOf(1),
    ]);
  });

  it("shows no more than 50 of an over-long answer", async () => {
    serveList(() =>
      listOf(
        Array.from({ length: 60 }, (_, i) =>
          requestOf(100 - i, [source("state", "pending"), source("national", "pending")]),
        ),
      ),
    );
    const { fetcher, store } = setup({ acknowledged: false });
    await fetcher.loadList();
    expect(store.getState().items).toHaveLength(50);
  });

  it("a second load does not duplicate rows", async () => {
    serveList(() => listOf([requestOf(1, [source("state", "pending")])]));
    const { fetcher, store } = setup({ acknowledged: false });
    await fetcher.loadList();
    await fetcher.loadList();
    expect(store.getState().items).toHaveLength(1);
  });

  it("calls made while one is in flight share it, with one trailing call", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = serveList(async () => {
      await gate;
      return listOf([]);
    });
    const { fetcher } = setup({ acknowledged: false });
    const first = fetcher.loadList();
    const second = fetcher.loadList();
    const third = fetcher.loadList();
    await pass(10);
    expect(calls).toHaveLength(1);
    release();
    await Promise.all([first, second, third]);
    await pass(10);
    expect(calls).toHaveLength(2);
  });

  it("fetches the payload of a returned source the list shows, and nothing for pending ones", async () => {
    serveList(() =>
      listOf([
        requestOf(2, [source("state", "returned"), source("national", "pending")]),
        requestOf(1, [source("state", "pending"), source("national", "pending")]),
      ]),
    );
    const detailCalls: string[] = [];
    server.use(
      http.get(`${BASE}/api/v1/queries/:id`, ({ params }) => {
        detailCalls.push(String(params.id));
        return HttpResponse.json(
          requestOf(2, [source("state", "returned", { a: 1 }), source("national", "pending")]),
        );
      }),
    );
    const { fetcher, store } = setup({ acknowledged: false });
    await fetcher.loadList();
    await pass(2000);
    expect(detailCalls).toEqual([idOf(2)]);
    expect(payloadsOf(store.getState().items[0])).toEqual([{ a: 1 }, undefined]);
  });

  it("a source the list shows returned is fetched even when the request was fetched before", async () => {
    const calls = serve(() =>
      HttpResponse.json(
        detailOf([source("state", "returned", { a: 1 }), source("national", "pending")]),
      ),
    );
    const { fetcher, apply, store } = setup();
    apply(event(1, "state", "returned"));
    await pass(2000);
    expect(calls).toHaveLength(1);
    serveList(() =>
      listOf([detailOf([source("state", "returned"), source("national", "returned")])]),
    );
    await fetcher.loadList();
    await pass(2000);
    expect(calls).toHaveLength(2);
    expect(store.getState().items).toHaveLength(1);
  });

  it("a network failure retries on the feed backoff and then merges", async () => {
    let n = 0;
    const calls = serveList(() => {
      n += 1;
      return n === 1 ? HttpResponse.error() : listOf([requestOf(1, [source("state", "pending")])]);
    });
    const { fetcher, store } = setup({ acknowledged: false });
    await fetcher.loadList();
    expect(calls).toHaveLength(1);
    expect(store.getState().items).toHaveLength(0);
    await pass(500);
    expect(calls).toHaveLength(1);
    await pass(600);
    expect(calls).toHaveLength(2);
    expect(store.getState().items).toHaveLength(1);
  });

  it("a 403 answer drops the load quietly", async () => {
    const calls = serveList(() =>
      HttpResponse.json({ error: { code: "forbidden" } }, { status: 403 }),
    );
    const { fetcher } = setup({ acknowledged: false });
    await fetcher.loadList();
    await pass(300_000);
    expect(calls).toHaveLength(1);
  });

  it("reset cancels a pending retry of the load", async () => {
    const calls = serveList(() => HttpResponse.error());
    const { fetcher, store } = setup({ acknowledged: false });
    await fetcher.loadList();
    expect(calls).toHaveLength(1);
    fetcher.reset();
    await pass(300_000);
    expect(calls).toHaveLength(1);
    expect(store.getState().items).toHaveLength(0);
  });

  it("reset drops the answer of a load that was still in flight", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    serveList(async () => {
      await gate;
      return listOf([requestOf(1, [source("state", "pending")])]);
    });
    const { fetcher, store } = setup({ acknowledged: false });
    const load = fetcher.loadList();
    await pass(10);
    fetcher.reset();
    release();
    await load;
    await pass(10);
    expect(store.getState().items).toHaveLength(0);
  });
});

describe("FR-065 at most 4 detail fetches in flight, entries in view first (spec 6.8)", () => {
  /**
   * Holds every detail fetch until the test lets it go; `started` lists the ids in the order the
   * requests were made. The list still goes through MSW. A fetch that is aborted ends quietly.
   */
  function gated() {
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = async (request: Request): Promise<Response> => {
      const id = /\/api\/v1\/queries\/([^/?]+)$/.exec(new URL(request.url).pathname)?.[1];
      if (id === undefined) return globalThis.fetch(request);
      started.push(id);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve, reject) => {
        gates.set(id, resolve);
        request.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
      inFlight -= 1;
      const n = Number(id.slice(-12));
      return HttpResponse.json(requestOf(n, [source("state", "returned", { n })]));
    };
    return {
      fetch: fetchImpl,
      started,
      peak: () => peak,
      release: async (id: string) => {
        gates.get(id)?.();
        await pass(10);
      },
    };
  }

  const listSix = () =>
    serveList(() =>
      listOf([6, 5, 4, 3, 2, 1].map((n) => requestOf(n, [source("state", "returned")]))),
    );

  it("starts four, and the next one when one finishes", async () => {
    listSix();
    const g = gated();
    const { fetcher } = setup({ acknowledged: false, fetch: g.fetch });
    await fetcher.loadList();
    await pass(2000);
    // The four requests arrive together, in no fixed order.
    expect([...g.started].sort()).toEqual([idOf(3), idOf(4), idOf(5), idOf(6)]);
    await g.release(idOf(6));
    expect(g.started).toHaveLength(5);
    await g.release(idOf(5));
    expect(g.started).toHaveLength(6);
    for (const n of [4, 3, 2, 1]) await g.release(idOf(n));
    expect(g.peak()).toBe(4);
  });

  it("the queue takes the entry nearest the top of the list first, whatever order they queued in", async () => {
    listSix();
    const g = gated();
    const { fetcher, apply } = setup({ acknowledged: false, fetch: g.fetch });
    await fetcher.loadList();
    await pass(2000);
    expect(g.started).toHaveLength(4);
    // Row 1 (bottom) is queued again before row 2; row 2 is nearer the top and goes first.
    apply(eventFor(1, 1, "state"));
    apply(eventFor(2, 2, "state"));
    await pass(2000);
    await g.release(idOf(6));
    expect(g.started.slice(4)).toEqual([idOf(2)]);
    await g.release(idOf(5));
    expect(g.started.slice(4)).toEqual([idOf(2), idOf(1)]);
  });

  it("reset empties the queue and the slots", async () => {
    listSix();
    const g = gated();
    const { fetcher } = setup({ acknowledged: false, fetch: g.fetch });
    await fetcher.loadList();
    await pass(2000);
    expect(g.started).toHaveLength(4);
    fetcher.reset();
    for (const n of [6, 5, 4, 3]) await g.release(idOf(n));
    await pass(300_000);
    expect(g.started).toHaveLength(4);
  });
});

describe("FR-065 refetch after a reconnect (spec 6.8)", () => {
  it("fetches every entry with a pending source and no others", async () => {
    const fetched: string[] = [];
    server.use(
      http.get(`${BASE}/api/v1/queries/:id`, ({ params }) => {
        fetched.push(String(params.id));
        return HttpResponse.json(requestOf(Number(String(params.id).slice(-12)), []));
      }),
    );
    const { fetcher, store } = setup({ acknowledged: false });
    store
      .getState()
      .applyList([
        requestOf(3, [source("state", "pending"), source("national", "pending")]),
        requestOf(2, [source("state", "failed"), source("national", "timedOut")]),
        requestOf(1, [source("state", "pending")]),
      ]);
    fetcher.refetchPending();
    await pass(2000);
    expect(fetched.sort()).toEqual([idOf(1), idOf(3)]);
  });

  it("also fetches a returned source that has no payload yet", async () => {
    const fetched: string[] = [];
    server.use(
      http.get(`${BASE}/api/v1/queries/:id`, ({ params }) => {
        fetched.push(String(params.id));
        return HttpResponse.error();
      }),
    );
    const { fetcher, store } = setup({ acknowledged: false });
    store.getState().applyList([requestOf(1, [source("state", "returned")])]);
    fetcher.reset();
    fetched.length = 0;
    fetcher.refetchPending();
    await pass(500);
    expect(fetched).toEqual([idOf(1)]);
  });

  it("fetches nothing when every returned source has its payload", async () => {
    const calls = serve(() => HttpResponse.json(detailOf([source("state", "returned", { a: 1 })])));
    const { fetcher, apply, store } = setup();
    store.getState().applyEvent(event(1, "national", "failed"));
    apply(event(2, "state", "returned"));
    await pass(2000);
    expect(calls).toHaveLength(1);
    fetcher.refetchPending();
    await pass(2000);
    expect(calls).toHaveLength(1);
  });

  it("an entry whose fetch is already waiting to retry is not fetched twice", async () => {
    const calls = serve(() => HttpResponse.error());
    const { fetcher, apply } = setup();
    apply(event(1, "state", "returned"));
    await pass(500);
    expect(calls).toHaveLength(1);
    fetcher.refetchPending();
    await pass(500);
    expect(calls).toHaveLength(1);
    await pass(600);
    expect(calls).toHaveLength(2);
  });

  it("reset after a refetch was scheduled cancels it", async () => {
    const calls = serve(() =>
      HttpResponse.json(detailOf([source("state", "pending"), source("national", "pending")])),
    );
    const { fetcher } = setup();
    fetcher.refetchPending();
    fetcher.reset();
    await pass(300_000);
    expect(calls).toHaveLength(0);
  });
});
