import type { QueryListEntry, SocketLike } from "@querymodule/client";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { heartbeatUrl } from "../status/use-status-checks.js";
import { FakeSocket } from "../test/fake-socket.js";
import { API, detail202, server, TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
import { testServices } from "../test/render-routes.js";

describe("SEC-006 sign-out clears query cache, announcer and preferences (spec 6.7)", () => {
  it("resets every registered store", async () => {
    const services = testServices();
    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    services.queryClient.setQueryData(["probe"], 1);
    services.announcer.announce("hello");
    services.preferences.getState().setThemeMode("night");
    await services.session.signOut();
    expect(services.queryClient.getQueryData(["probe"])).toBeUndefined();
    expect(services.announcer.current()).toEqual({ polite: null, assertive: null });
    expect(services.preferences.getState().themeMode).toBeNull();
    expect(services.authStore.getState().status).toBe("signedOut");
  });

  it("cancels in-flight queries before clearing the cache on sign-out (SEC-006)", async () => {
    const services = testServices();
    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    const cancelSpy = vi.spyOn(services.queryClient, "cancelQueries");
    const clearSpy = vi.spyOn(services.queryClient, "clear");
    await services.session.signOut();
    expect(cancelSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("#361 sign-out and a 401 on the background config fetch stop the config refresh", async () => {
    const services = testServices();
    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    const stop = vi.spyOn(services.configRefresh, "stop");
    await services.session.signOut();
    expect(stop).toHaveBeenCalled();

    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    stop.mockClear();
    server.use(http.get(`${API}/api/v1/config`, () => new HttpResponse(null, { status: 401 })));
    await services.api.GET("/api/v1/config", { headers: { "X-Background": "1" } });
    expect(stop).toHaveBeenCalled();
  });

  it("wires the API client's onUnauthenticated to session.handleUnauthenticated", async () => {
    const services = testServices();
    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    services.queryClient.setQueryData(["probe"], 1);
    server.use(http.get(`${API}/api/v1/meta`, () => new HttpResponse(null, { status: 401 })));
    await services.api.GET("/api/v1/meta");
    expect(services.authStore.getState().status).toBe("signedOut");
    expect(services.queryClient.getQueryData(["probe"])).toBeUndefined();
  });
});

describe("FR-056, SEC-006 draft store (spec 6.7)", () => {
  it("resetAll resets the draft store", () => {
    const services = testServices();
    services.drafts.getState().select("VEH");
    services.drafts.getState().setValue("plate", "ZZ-0001");
    services.reset.resetAll();
    expect(services.drafts.getState().queryType).toBeNull();
    expect(services.drafts.getState().drafts).toEqual({});
  });

  it("resetAll returns form mode and empty terminal text", () => {
    const services = testServices();
    services.drafts.getState().setMode("terminal");
    services.drafts.getState().setTerminalText("VEH.ZZ-0001");
    services.reset.resetAll();
    expect(services.drafts.getState().mode).toBe("form");
    expect(services.drafts.getState().terminalText).toBe("");
  });

  it("writes nothing to localStorage or sessionStorage across 100 draft writes", () => {
    const keys = () => [Object.keys(localStorage), Object.keys(sessionStorage)];
    const services = testServices();
    const before = keys();
    const cookieWrites = vi.spyOn(document, "cookie", "set");
    services.drafts.getState().select("VEH");
    for (let i = 0; i < 100; i += 1) services.drafts.getState().setValue(`f${i}`, `v${i}`);
    expect(keys()).toEqual(before);
    expect(cookieWrites).not.toHaveBeenCalled();
    cookieWrites.mockRestore();
  });
});

describe("FR-064, SEC-006 submit controller (spec 6.7)", () => {
  it("resetAll resets the submit controller", () => {
    const services = testServices();
    services.submit.setState({ status: "noConnection" });
    services.reset.resetAll();
    expect(services.submit.getState().status).toBe("idle");
  });
});

describe("spec 6.7 requests list (memory only)", () => {
  it("resetAll clears this session's requests", () => {
    const services = testServices();
    services.requests.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001.TX" });
    expect(services.requests.getState().items).toHaveLength(1);
    services.reset.resetAll();
    expect(services.requests.getState().items).toEqual([]);
  });
});

describe("FR-065 feed socket in the composition root (spec 6.7, 6.8)", () => {
  afterEach(() => vi.useRealTimers());

  function feedServices() {
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const createSocket = (url: string): SocketLike => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    };
    return { services: testServices({ createSocket }), sockets, urls };
  }

  it("builds the feed on createSocket and does not connect until opened", () => {
    const t = feedServices();
    expect(t.services.feed.state()).toBe("closed");
    expect(t.sockets).toHaveLength(0);
    t.services.feed.open();
    expect(t.urls).toEqual([heartbeatUrl(location)]);
    t.services.reset.resetAll();
  });

  it("resetAll closes the feed and its socket", () => {
    const t = feedServices();
    t.services.feed.open();
    t.services.reset.resetAll();
    expect(t.services.feed.state()).toBe("closed");
    expect(t.sockets[0]?.closed).toBe(true);
  });

  it("sign-out closes the feed", async () => {
    const t = feedServices();
    await t.services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    t.services.feed.open();
    await t.services.session.signOut();
    expect(t.services.feed.state()).toBe("closed");
    expect(t.sockets[0]?.closed).toBe(true);
  });

  it("a 4001 close from the server arrives with its code and does not reconnect", () => {
    vi.useFakeTimers();
    const t = feedServices();
    t.services.feed.open();
    t.sockets[0]?.onclose?.({ code: 4001 });
    expect(t.services.feed.state()).toBe("closed");
    vi.advanceTimersByTime(120_000);
    expect(t.sockets).toHaveLength(1);
  });

  it("any other close reconnects", () => {
    vi.useFakeTimers();
    const t = feedServices();
    t.services.feed.open();
    t.sockets[0]?.onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1000);
    expect(t.sockets).toHaveLength(2);
    t.services.reset.resetAll();
  });
});

describe("FR-065 replay cursor, resync and the list load in the composition root (spec 4.7, 6.8)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The feed's reconnect jitter draws from Math.random: no wait, so each backoff step is exact.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Advances the fake clock, then yields to real I/O so MSW's answer lands before the next check. */
  async function pass(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }

  const idOf = (n: number): string => `0198a1b2-c3d4-7e5f-8a9b-${n.toString().padStart(12, "0")}`;
  /** A list entry for request n with the given source statuses (mock data only). */
  const request = (n: number, statuses: ("pending" | "returned" | "failed")[]): QueryListEntry =>
    ({
      ...detail202(statuses.map((status, i) => ({ sourceId: `s${i}`, status }))),
      correlationId: idOf(n),
      submittedAt: Date.UTC(2026, 8, 29, 17, 0, n),
    }) as QueryListEntry;
  const listBody = (...requests: QueryListEntry[]) => ({
    requests,
    nextCursor: null,
  });

  function feedServices() {
    const sockets: FakeSocket[] = [];
    const services = testServices({
      createSocket: (): SocketLike => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    /** Plays the server: delivers one message to the socket the feed is using. */
    const deliver = (socket: FakeSocket, message: object): void =>
      socket.onmessage?.({ data: JSON.stringify({ v: 1, ...message }) });
    const hellos = (): unknown[] =>
      sockets
        .flatMap((socket) =>
          socket.sent.map(
            (frame) => JSON.parse(frame) as { type: string; lastSeq?: number | null },
          ),
        )
        .filter((m) => m.type === "hello")
        .map((m) => m.lastSeq);
    return { services, sockets, deliver, hellos };
  }

  function recordList(requests: QueryListEntry[]) {
    const calls: { url: URL; background: string | null }[] = [];
    server.use(
      http.get(`${API}/api/v1/queries`, ({ request: req }) => {
        calls.push({ url: new URL(req.url), background: req.headers.get("x-background") });
        return HttpResponse.json(listBody(...requests));
      }),
    );
    return calls;
  }

  function recordDetails() {
    const fetched: string[] = [];
    server.use(
      http.get(`${API}/api/v1/queries/:correlationId`, ({ params }) => {
        fetched.push(String(params.correlationId));
        // The request asked for, still with a pending source; the other has its payload.
        return HttpResponse.json({
          ...detail202([
            { sourceId: "s0", status: "pending" },
            { sourceId: "s1", status: "returned", payload: { ok: true } },
          ]),
          correlationId: String(params.correlationId),
        });
      }),
    );
    return fetched;
  }

  it("sign-in loads the list as a background call and shows its requests", async () => {
    const calls = recordList([request(2, ["pending"]), request(1, ["failed"])]);
    const { services } = feedServices();
    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    await pass(50);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.searchParams.get("limit")).toBe("50");
    expect(calls[0]?.background).toBe("1");
    const rows = services.requests.getState().items;
    expect(rows.map((r) => r.status === "acknowledged" && r.correlationId)).toEqual([
      idOf(2),
      idOf(1),
    ]);
    services.reset.resetAll();
  });

  it("an existing session at page load also loads the list (the sign-in state is what counts)", async () => {
    const calls = recordList([request(1, ["pending"])]);
    const { services } = feedServices();
    services.authStore.getState().setSignedIn({ ...TEST_USER });
    await pass(50);
    expect(calls).toHaveLength(1);
    services.reset.resetAll();
  });

  it("a session still owing a password change loads nothing until it is changed", async () => {
    const calls = recordList([request(1, ["pending"])]);
    const { services } = feedServices();
    services.authStore.getState().setSignedIn({ ...TEST_USER, mustChangePassword: true as const });
    await pass(50);
    expect(calls).toHaveLength(0);
    services.authStore.getState().setPasswordChangeRequired(false);
    await pass(50);
    expect(calls).toHaveLength(1);
    services.reset.resetAll();
  });

  it("a resync loads the list once and merges it without duplicating rows", async () => {
    const calls = recordList([request(2, ["pending"]), request(1, ["failed"])]);
    const t = feedServices();
    await t.services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    await pass(50);
    expect(calls).toHaveLength(1);
    t.services.feed.open();
    const socket = t.sockets[0] as FakeSocket;
    socket.onopen?.();
    await pass(0);
    t.deliver(socket, { type: "resync", reason: "tooOld", latestSeq: 3 });
    await pass(50);
    expect(calls).toHaveLength(2);
    expect(t.services.requests.getState().items).toHaveLength(2);
    t.services.reset.resetAll();
  });

  it("a reconnect says hello with the mark, and refetches entries with a pending source only", async () => {
    const t = feedServices();
    await t.services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    await pass(50);
    t.services.requests
      .getState()
      .applyList([request(2, ["pending", "returned"]), request(1, ["failed", "failed"])]);
    const fetched = recordDetails();
    t.services.feed.open();
    const first = t.sockets[0] as FakeSocket;
    first.onopen?.();
    await pass(0);
    t.deliver(first, {
      type: "resultHidden",
      seq: 7,
      at: 1,
      correlationId: idOf(9),
      resultIds: [idOf(10)],
    });
    first.onclose?.({ code: 1006 });
    await pass(1000);
    fetched.length = 0;
    const second = t.sockets[1] as FakeSocket;
    second.onopen?.();
    await pass(1000);
    expect(t.hellos()).toEqual([null, 7]);
    expect(fetched.length).toBeGreaterThan(0);
    expect(new Set(fetched)).toEqual(new Set([idOf(2)]));
    t.services.reset.resetAll();
  });

  it("while the socket is down a pending entry is refetched at each backoff step", async () => {
    const t = feedServices();
    await t.services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    await pass(50);
    t.services.requests.getState().applyList([request(2, ["pending"])]);
    const fetched = recordDetails();
    t.services.feed.open();
    const first = t.sockets[0] as FakeSocket;
    first.onopen?.();
    await pass(0);
    first.onclose?.({ code: 1006 });
    // Step 1: at most 1 s of jitter, then the reconnect attempt that never opens.
    await pass(1000);
    expect(t.sockets).toHaveLength(2);
    expect(fetched).toEqual([idOf(2)]);
    (t.sockets[1] as FakeSocket).onclose?.({ code: 1006 });
    // Step 2: at most 2 s.
    await pass(2000);
    expect(t.sockets).toHaveLength(3);
    expect(fetched).toEqual([idOf(2), idOf(2)]);
    t.services.reset.resetAll();
  });

  it("logout resets the mark and the rows: the next session says hello with a null cursor and loads the list again", async () => {
    const calls = recordList([request(1, ["pending"])]);
    const t = feedServices();
    await t.services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    await pass(50);
    t.services.feed.open();
    const first = t.sockets[0] as FakeSocket;
    first.onopen?.();
    await pass(0);
    t.deliver(first, {
      type: "resultHidden",
      seq: 4,
      at: 1,
      correlationId: idOf(9),
      resultIds: [idOf(10)],
    });
    await t.services.session.signOut();
    expect(t.services.requests.getState().items).toEqual([]);
    await t.services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    await pass(50);
    expect(calls).toHaveLength(2);
    t.services.feed.open();
    const second = t.sockets[1] as FakeSocket;
    second.onopen?.();
    await pass(0);
    expect(t.hellos()).toEqual([null, null]);
    t.services.reset.resetAll();
  });

  it("a list answer that lands after logout is dropped", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/api/v1/queries`, async () => {
        await gate;
        return HttpResponse.json(listBody(request(1, ["pending"])));
      }),
    );
    const { services } = feedServices();
    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    await pass(50);
    await services.session.signOut();
    release();
    await pass(50);
    expect(services.requests.getState().items).toEqual([]);
  });
});
