import { createTranslator, type SubmitQueryResponse } from "@querymodule/client";
import { resolveShortcuts } from "@querymodule/core/config";
import { ShortcutProvider } from "@querymodule/web-ui";
import { act, screen, waitFor } from "@testing-library/react";
import { Profiler, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../app/i18n-context.js";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { ACK_202, CLIENT_CONFIG, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";
import { QueryPanelView } from "./QueryPanelView.js";
import { RequestsPane } from "./RequestsPane.js";

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
  it("a keystroke builds no Intl formatter (whatever else re-renders)", async () => {
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

  it("RequestsPane itself bails out when its parent re-renders with the same props (the memo)", async () => {
    // A stable translator whose t() counts the list's heading lookups: every render of the pane asks.
    const base = createTranslator("en", EN_BUNDLE);
    const asked = { n: 0 };
    const translator = {
      ...base,
      t: ((key: string, params?: Parameters<typeof base.t>[1]) => {
        if (key === "requests.heading") asked.n += 1;
        return base.t(key, params);
      }) as typeof base.t,
    };
    let bump: () => void = () => undefined;
    function Parent() {
      const [, setTick] = useState(0);
      bump = () => setTick((n) => n + 1);
      // What a keystroke does to the panel around the list: the parent re-renders, props unchanged.
      return (
        <I18nProvider translator={translator}>
          <RequestsPane config={CLIENT_CONFIG} variant="list" />
        </I18nProvider>
      );
    }
    const services = testServices();
    services.authStore.getState().setSignedIn(TEST_USER);
    renderRoutes([{ path: "/", element: <Parent /> }], { services });
    await screen.findByRole("region", { name: "Requests this shift" });
    // Let the mount settle (the first render and its effects).
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    });
    const before = asked.n;
    expect(before).toBeGreaterThan(0);
    act(() => bump());
    act(() => bump());
    expect(asked.n).toBe(before);
  });
});
