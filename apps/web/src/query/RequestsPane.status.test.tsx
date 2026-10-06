import type { SubmitQueryResponse } from "@querymodule/client";
import { act, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ACK_CORRELATION_ID, FeedDriver } from "../test/feed-driver.js";
import { CLIENT_CONFIG, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";
import { RequestsPane } from "./RequestsPane.js";

const ACK: SubmitQueryResponse = {
  correlationId: ACK_CORRELATION_ID,
  acknowledgedAt: Date.UTC(2026, 8, 29, 17, 4, 5),
  parts: [
    {
      partId: 1,
      queryType: "VEH",
      status: "dispatched",
      sourceIds: ["stateSource", "nationalSource"],
      droppedSourceIds: [],
    },
  ],
};

function setup(response = ACK) {
  const driver = new FeedDriver();
  const services = testServices({ createSocket: driver.createSocket });
  services.authStore.getState().setSignedIn(TEST_USER);
  const id = services.requests.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
  act(() => {
    services.requests.getState().settle(id, { kind: "acknowledged", response, queryType: "VEH" });
  });
  const view = renderRoutes(
    [
      {
        path: "/",
        element: (
          <>
            <input aria-label="Plate" />
            <RequestsPane config={CLIENT_CONFIG} variant="list" />
          </>
        ),
      },
    ],
    { services },
  );
  return { ...view, driver };
}

const sourceList = () => screen.getByRole("group", { name: /Source status for VEH\.ZZ-0001/ });

describe("FR-043 the requests list shows per-source status (spec 6.2, 6.6)", () => {
  it("after an acknowledgment each source line reads pending, in words", () => {
    setup();
    const list = sourceList();
    expect(within(list).getByText("State system: pending")).toBeInTheDocument();
    expect(within(list).getByText("National system: pending")).toBeInTheDocument();
  });

  it("an event turns one line into returned in place while focus and the typed value stay", async () => {
    const { driver, services, user } = setup();
    services.feed.open();
    await user.click(screen.getByLabelText("Plate"));
    await user.keyboard("ABC");
    const line = within(sourceList()).getByText("State system: pending").closest(".qm-source");
    const row = line?.closest("li.qm-request");
    act(() => driver.status("stateSource", "returned"));
    const after = within(sourceList()).getByText("State system: returned").closest(".qm-source");
    expect(after).toBe(line);
    expect(within(sourceList()).getByText("National system: pending")).toBeInTheDocument();
    expect(after?.closest("li.qm-request")).toBe(row);
    expect(screen.getByLabelText("Plate")).toHaveFocus();
    expect(screen.getByLabelText("Plate")).toHaveValue("ABC");
    services.feed.close();
  });

  it("a focused control inside the row keeps focus when an event arrives", async () => {
    const { driver, services, user } = setup();
    services.feed.open();
    const copy = screen.getByRole("button", { name: /^Copy reference/ });
    await user.click(copy);
    copy.focus();
    act(() => driver.status("nationalSource", "timedOut"));
    expect(within(sourceList()).getByText("National system: timed out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Copy reference/ })).toBe(copy);
    expect(copy).toHaveFocus();
    services.feed.close();
  });

  it("a nested part is labelled with its origin and a skipped part says skipped", () => {
    setup({
      ...ACK,
      parts: [
        ...ACK.parts,
        {
          partId: 2,
          queryType: "WNT",
          status: "dispatched",
          sourceIds: ["nationalSource"],
          droppedSourceIds: [],
        },
        { partId: 3, queryType: "PRO", status: "skipped", sourceIds: [], droppedSourceIds: [] },
      ],
    });
    expect(screen.getByText("Also run: Wanted check")).toBeInTheDocument();
    expect(screen.getByText(/was not run\./)).toBeInTheDocument();
    expect(within(sourceList()).getAllByText("National system: pending")).toHaveLength(2);
  });

  it("sign-out empties the list", () => {
    const { services } = setup();
    act(() => services.reset.resetAll());
    expect(screen.queryByRole("group", { name: /Source status/ })).toBeNull();
  });
});
