import { shortReference } from "@querymodule/web-ui";
import { act, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { ACK_CORRELATION_ID, FeedDriver } from "../test/feed-driver.js";
import { API, detail202, server, TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";
import { testServices } from "../test/render-routes.js";

const ACK = {
  correlationId: ACK_CORRELATION_ID,
  acknowledgedAt: Date.UTC(2026, 8, 29, 17, 4, 5),
  parts: [
    {
      partId: 1,
      parentPartId: null,
      origin: "primary" as const,
      queryType: "VEH",
      status: "dispatched" as const,
      sourceIds: ["stateSource", "nationalSource"],
      droppedSourceIds: [],
      skipReasons: [],
    },
  ],
};

describe("FR-065 the feed's events reach the requests store (spec 6.7)", () => {
  it("a sourceStatus event from the socket moves the matching source", async () => {
    const driver = new FeedDriver();
    const services = testServices({ createSocket: driver.createSocket });
    const id = services.requests.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    services.requests
      .getState()
      .settle(id, { kind: "acknowledged", response: ACK, queryType: "VEH" });
    services.feed.open();
    await waitFor(() => expect(services.feed.state()).toBe("open"));
    driver.status("stateSource", "returned");
    const row = services.requests.getState().items[0];
    if (row?.status !== "acknowledged") throw new Error("not acknowledged");
    expect(row.parts[0]?.sources.map((s) => s.status)).toEqual(["returned", "pending"]);
    services.feed.close();
  });
});

describe("spec 6.7 the feed's events fetch the result payloads", () => {
  it("a returned event fills the source's payload, which sign-out clears", async () => {
    server.use(
      http.get(`${API}/api/v1/queries/:id`, () =>
        HttpResponse.json(
          detail202([
            { sourceId: "stateSource", status: "returned", payload: { make: "ZZ-MAKE" } },
            { sourceId: "nationalSource", status: "pending" },
          ]),
        ),
      ),
    );
    const driver = new FeedDriver();
    const services = testServices({ createSocket: driver.createSocket });
    const id = services.requests.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    services.requests
      .getState()
      .settle(id, { kind: "acknowledged", response: ACK, queryType: "VEH" });
    services.feed.open();
    await waitFor(() => expect(services.feed.state()).toBe("open"));
    driver.status("stateSource", "returned");
    const payload = () => {
      const row = services.requests.getState().items[0];
      return row?.status === "acknowledged" ? row.parts[0]?.sources[0]?.result?.payload : undefined;
    };
    await waitFor(() => expect(payload()).toEqual({ make: "ZZ-MAKE" }));
    services.reset.resetAll();
    expect(services.requests.getState().items).toEqual([]);
  });
});

describe("FR-044 AppShell announces one coalesced summary (spec 6.6)", () => {
  it("two events in one window give one polite sentence, with no values", async () => {
    const driver = new FeedDriver();
    const t = renderRoot({ createSocket: driver.createSocket });
    await t.user.type(await screen.findByLabelText(/Email/), TEST_USER.email);
    await t.user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
    await t.user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Query Module" });
    await waitFor(() => expect(t.services.feed.state()).toBe("open"));
    const id = t.services.requests.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    act(() => {
      t.services.requests
        .getState()
        .settle(id, { kind: "acknowledged", response: ACK, queryType: "VEH" });
    });
    act(() => {
      driver.status("stateSource", "returned");
      driver.status("nationalSource", "returned");
    });
    const polite = await screen.findByTestId("announcer-polite", {}, { timeout: 4000 });
    await waitFor(() => expect(polite).toHaveTextContent(/2 of 2 sources done\. 2 returned\./), {
      timeout: 4000,
    });
    // Ruling 12 (10-13-26): this row kept no values, so the short ID names it.
    expect(polite.textContent).toContain(shortReference(ACK_CORRELATION_ID));
    expect(polite.textContent).not.toContain("ZZ-0001");
  });
});

describe("FR-064 spec 6.6 a critical result is announced assertively at once", () => {
  it("speaks the keyword and source in the assertive region before the polite window, no other payload value", async () => {
    server.use(
      http.get(`${API}/api/v1/queries/:id`, () =>
        HttpResponse.json(
          detail202([
            {
              sourceId: "stateSource",
              status: "returned",
              payload: { status: "STOLEN", make: "ZZ-TESTMAKE" },
            },
            {
              sourceId: "nationalSource",
              status: "returned",
              payload: { status: "STOLEN", make: "ZZ-TESTMAKE" },
            },
          ]),
        ),
      ),
    );
    const driver = new FeedDriver();
    const t = renderRoot({ createSocket: driver.createSocket });
    await t.user.type(await screen.findByLabelText(/Email/), TEST_USER.email);
    await t.user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
    await t.user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Query Module" });
    await waitFor(() => expect(t.services.feed.state()).toBe("open"));
    const id = t.services.requests.getState().begin({
      queryType: "VEH",
      summary: "VEH.ZZ-0001",
      submitted: { queryType: "VEH", values: { plate: "ZZ-0001" }, sourceIds: [], mode: "normal" },
    });
    act(() => {
      t.services.requests
        .getState()
        .settle(id, { kind: "acknowledged", response: ACK, queryType: "VEH" });
    });
    act(() => {
      driver.status("stateSource", "returned");
      driver.status("nationalSource", "returned");
    });
    const assertive = screen.getByTestId("announcer-assertive");
    await waitFor(
      () =>
        expect(assertive).toHaveTextContent(
          /^Vehicle ZZ-0001: critical: STOLEN, (State|National) system\./,
        ),
      { timeout: 1200 },
    );
    // Said before the 1500 ms window closed: the polite summary is not here yet.
    expect(screen.getByTestId("announcer-polite")).not.toHaveTextContent(/sources done/);
    expect(assertive.textContent).not.toContain("TESTMAKE");
    await waitFor(
      () =>
        expect(screen.getByTestId("announcer-polite")).toHaveTextContent(
          "Vehicle ZZ-0001: 2 of 2 sources done. 2 returned, critical: STOLEN.",
        ),
      { timeout: 4000 },
    );
    expect(screen.getByTestId("announcer-polite").textContent).not.toContain("TESTMAKE");
  });
});

describe("FR-064, FR-065 spec 6.6 rows loaded from the list are history, never announced", () => {
  it("a list load followed by detail fetches speaks nothing, critical payloads included", async () => {
    const stolen = { status: "STOLEN", make: "ZZ-TESTMAKE" };
    const source = (sourceId: string) => ({ sourceId, status: "returned" });
    server.use(
      http.get(`${API}/api/v1/queries`, () =>
        HttpResponse.json({
          requests: [detail202([source("stateSource"), source("nationalSource")])],
          nextCursor: null,
        }),
      ),
      http.get(`${API}/api/v1/queries/:id`, () =>
        HttpResponse.json(
          detail202([
            { ...source("stateSource"), payload: stolen },
            { ...source("nationalSource"), payload: stolen },
          ]),
        ),
      ),
    );
    const driver = new FeedDriver();
    const t = renderRoot({ createSocket: driver.createSocket });
    const summaries: unknown[] = [];
    const arrivals: unknown[] = [];
    t.services.requests.getState().onStatusSummary((a) => summaries.push(a));
    t.services.requests.getState().onResult((a) => arrivals.push(a));
    await t.user.type(await screen.findByLabelText(/Email/), TEST_USER.email);
    await t.user.type(screen.getByLabelText(/Password/), TEST_PASSWORD);
    await t.user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Query Module" });
    const payload = () => {
      const row = t.services.requests.getState().items[0];
      return row?.status === "acknowledged" ? row.parts[0]?.sources[0]?.result?.payload : undefined;
    };
    await waitFor(() => expect(payload()).toEqual(stolen), { timeout: 4000 });
    // Past the 1500 ms coalescing window, so a summary would have fired by now.
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(arrivals).toEqual([]);
    expect(summaries).toEqual([]);
    expect(t.services.announcer.current()).toEqual({ polite: null, assertive: null });
  });
});
