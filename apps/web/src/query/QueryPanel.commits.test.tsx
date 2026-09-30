import type { SubmitQueryResponse } from "@querymodule/client";
import { resolveShortcuts } from "@querymodule/core/config";
import { ShortcutProvider } from "@querymodule/web-ui";
import { act, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { describe, expect, it, vi } from "vitest";
import { ACK_202, CLIENT_CONFIG, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";
import { QueryPanelView } from "./QueryPanelView.js";

// Keystroke cost (perf measurement, work queue item 3): a keystroke in a field never re-renders the
// requests list beside the panel (a row per request, each formatting its time).

function renderPanel(commits: { n: number }) {
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  // The panel view alone (the live route without the app shell around it): what a keystroke renders.
  const routes = [
    {
      path: "/",
      element: (
        <ShortcutProvider bindings={resolveShortcuts(CLIENT_CONFIG.shortcuts)}>
          <Profiler id="panel" onRender={() => (commits.n += 1)}>
            <QueryPanelView
              config={CLIENT_CONFIG}
              drafts={services.drafts}
              mode="live"
              idPrefix="pv"
              requests="list"
            />
          </Profiler>
        </ShortcutProvider>
      ),
    },
  ];
  return renderRoutes(routes, { services });
}

async function openPanel(commits: { n: number }) {
  const view = renderPanel(commits);
  await screen.findByLabelText("Plate");
  await waitFor(() => expect(view.services.drafts.getState().queryType).not.toBeNull());
  return view;
}

/** Waits until nothing has committed for a moment, so a check starts from a settled page. */
async function settle(commits: { n: number }) {
  let last = -1;
  await waitFor(() => {
    const before = last;
    last = commits.n;
    expect(before).toBe(commits.n);
  });
}

describe("keystroke cost: the requests list is left alone", () => {
  it("does not re-render the requests rows on a keystroke (no date formatting per row)", async () => {
    const commits = { n: 0 };
    const { user, services } = await openPanel(commits);
    for (let i = 0; i < 5; i += 1) {
      const id = services.requests
        .getState()
        .begin({ queryType: "VEH", summary: `VEH.ZZ-000${i}` });
      act(() =>
        services.requests.getState().settle(id, {
          kind: "acknowledged",
          response: ACK_202 as SubmitQueryResponse,
          queryType: "VEH",
        }),
      );
    }
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(5));
    const plate = screen.getByLabelText("Plate");
    await user.click(plate);
    await settle(commits);
    const construct = vi.spyOn(Intl, "DateTimeFormat");
    try {
      await user.keyboard("Z");
      await settle(commits);
      expect(construct).not.toHaveBeenCalled();
    } finally {
      construct.mockRestore();
    }
  });
});
