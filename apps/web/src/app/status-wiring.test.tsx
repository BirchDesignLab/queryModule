import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ACK_CORRELATION_ID, FeedDriver } from "../test/feed-driver.js";
import { TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
import { renderRoot } from "../test/render-root.js";
import { testServices } from "../test/render-routes.js";

const ACK = {
  correlationId: ACK_CORRELATION_ID,
  acknowledgedAt: Date.UTC(2026, 8, 29, 17, 4, 5),
  parts: [
    {
      partId: 1,
      queryType: "VEH",
      status: "dispatched" as const,
      sourceIds: ["stateSource", "nationalSource"],
      droppedSourceIds: [],
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
    expect(polite.textContent).toContain("0198a1b2");
    expect(polite.textContent).not.toContain("ZZ-0001");
  });
});
