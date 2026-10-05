import type { SocketLike } from "@querymodule/client";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { heartbeatUrl } from "../status/use-status-checks.js";
import { FakeSocket } from "../test/fake-socket.js";
import { API, server, TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
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
