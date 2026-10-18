import { mapResponse } from "@querymodule/core/response";
import { act, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACK_CORRELATION_ID } from "../test/feed-driver.js";
import { CLIENT_CONFIG, detail202, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";
import { RequestsPane } from "./RequestsPane.js";

vi.mock("@querymodule/core/response", async (importOriginal) => {
  const real = await importOriginal<typeof import("@querymodule/core/response")>();
  return { ...real, mapResponse: vi.fn(real.mapResponse) };
});

// BW3 Task 6 (#735; FR-062 read half, SEC-021; spec 5.5, 6.2; D-M2P2-B4): a purged result shows
// "Purged under retention" in place of a mapped card, and a purged request keeps only its type
// values. Payloads here are synthetic (spec 5.4): plates ZZ-####.

const STOLEN = { status: "STOLEN", plate: "ZZ-0001", remarks: "STOLEN VEHICLE" };

/** A fetched detail for the canned request: one part, each source as given. */
function detail(
  sources: { sourceId: string; payload?: Record<string, unknown>; purged?: boolean }[],
  part: Record<string, unknown> = {},
) {
  const base = detail202();
  return {
    ...base,
    parts: [
      {
        ...(base.parts[0] as object),
        partId: 1,
        parentPartId: null,
        origin: "primary",
        queryType: "VEH",
        ...part,
        sources: sources.map((s) => ({
          ...(base.parts[0]?.sources[0] as object),
          status: "returned",
          receivedAt: Date.UTC(2026, 8, 29, 17, 4, 5),
          purged: false,
          // A purged result has no payload at all; the shared fixture source carries one.
          payload: undefined,
          ...s,
        })),
      },
    ],
  } as never;
}

function setup(detailBody: unknown, options: { sent?: boolean } = {}) {
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  const edits: string[] = [];
  act(() => {
    if (options.sent === true) {
      const id = services.requests.getState().begin({
        queryType: "VEH",
        summary: "ignored",
        submitted: {
          queryType: "VEH",
          values: { plate: "ZZ-0001" },
          sourceIds: [],
          mode: "normal",
        },
      });
      services.requests.getState().settle(id, {
        kind: "acknowledged",
        response: {
          correlationId: ACK_CORRELATION_ID,
          acknowledgedAt: Date.UTC(2026, 8, 29, 17, 4, 5),
          parts: [
            {
              partId: 1,
              parentPartId: null,
              origin: "primary",
              queryType: "VEH",
              status: "dispatched",
              sourceIds: ["stateSource", "nationalSource"],
              droppedSourceIds: [],
              skipReasons: [],
            },
          ],
        },
        queryType: "VEH",
      });
    }
    // Without a sent row the detail makes a placeholder, as a listed request after a reload does.
    services.requests.getState().applyDetail(detailBody as never);
  });
  const view = renderRoutes(
    [
      {
        path: "/",
        element: (
          <RequestsPane
            config={CLIENT_CONFIG}
            variant="list"
            onEditAsNew={(id) => edits.push(id)}
          />
        ),
      },
    ],
    { services },
  );
  return { ...view, edits };
}

const row = () => document.querySelector("li.qm-request") as HTMLElement;
beforeEach(() => {
  // Braces: a returned function would be run by vitest as the hook's cleanup.
  vi.mocked(mapResponse).mockClear();
});

describe("a purged result", () => {
  it("is the purged card, not a loading line, and never reaches the mapper", () => {
    setup(
      detail([{ sourceId: "nationalSource", purged: true }], { values: { plate: "ZZ-0001" } }),
      { sent: true },
    );
    const card = screen.getByRole("region", { name: "National system: returned" });
    expect(card).toHaveTextContent("Purged under retention");
    expect(card.className).toContain("qm-card--purged");
    expect(within(card).queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Loading/i)).toBeNull();
    expect(mapResponse).not.toHaveBeenCalled();
  });

  it("sits beside a current card: only the current one is mapped, badged and counted", () => {
    setup(
      detail(
        [
          { sourceId: "stateSource", payload: STOLEN },
          { sourceId: "nationalSource", purged: true },
        ],
        { values: { plate: "ZZ-0001" } },
      ),
      { sent: true },
    );
    const current = screen.getByRole("region", { name: "State system: returned" });
    expect(within(current).getByText("Critical")).toBeVisible();
    const purged = screen.getByRole("region", { name: "National system: returned" });
    expect(purged).toHaveTextContent("Purged under retention");
    expect(within(purged).queryByText("Critical")).toBeNull();
    expect(mapResponse).toHaveBeenCalledTimes(1);
  });

  it("a request whose results are all purged shows no severity badge", () => {
    setup(
      detail([{ sourceId: "nationalSource", purged: true }], { values: { plate: "ZZ-0001" } }),
      { sent: true },
    );
    expect(row().querySelector(".qm-request__severity")).toBeNull();
  });
});

describe("a request sent in this session", () => {
  it("keeps a working Edit as new query from its in-memory values when the detail reports purged values", () => {
    const { edits } = setup(
      detail([{ sourceId: "nationalSource", purged: true }], {
        purged: true,
        typeValues: { plateType: "PASSENGER" },
      }),
      { sent: true },
    );
    const button = within(row()).getByRole("button", { name: /^Edit as new query/ });
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(row()).not.toHaveTextContent(/values purged/i);
    button.click();
    expect(edits).toHaveLength(1);
  });
});

describe("a request whose values were purged", () => {
  const purgedValues = () =>
    detail([{ sourceId: "nationalSource", purged: true }], {
      queryType: "VEH",
      purged: true,
      typeValues: { plateType: "PASSENGER" },
    });

  it("keeps the type values and says the rest were purged", () => {
    setup(purgedValues());
    expect(row().querySelector("code")).toHaveTextContent("PASSENGER");
    expect(row()).toHaveTextContent("Other values purged under retention");
  });

  it("Edit as new query is disabled with its reason, focusable, and does nothing (D-M2P2-B4)", () => {
    const { edits } = setup(purgedValues());
    const button = within(row()).getByRole("button", { name: /^Edit as new query/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("The values were purged under retention.");
    button.focus();
    expect(button).toHaveFocus();
    button.click();
    expect(edits).toEqual([]);
  });

  it("a request that kept its values keeps its working Edit as new query", () => {
    const { edits } = setup(
      detail([{ sourceId: "nationalSource", purged: true }], { values: { plate: "ZZ-0001" } }),
    );
    const button = within(row()).getByRole("button", { name: /^Edit as new query/ });
    expect(button).not.toHaveAttribute("aria-disabled");
    button.click();
    expect(edits).toHaveLength(1);
    expect(row()).not.toHaveTextContent(/values purged/i);
  });
});
