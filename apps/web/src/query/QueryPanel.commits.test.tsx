import { act, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

// #478: typing a character in the query panel is one React commit, not two. The second commit came
// from effects that call a state setter on every edit although nothing changed: React cannot always
// skip such a call before it re-renders, and the re-render is a commit. Counted with a Profiler
// around the whole app.

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

describe("#478 one commit per keystroke", () => {
  it("typing a plate character commits once", async () => {
    let commits = 0;
    const services = testServices();
    services.authStore.getState().setSignedIn(TEST_USER);
    const routes = [
      {
        element: (
          <Profiler id="app" onRender={() => commits++}>
            <ClientSupportProvider clientSupported>
              <Outlet />
            </ClientSupportProvider>
          </Profiler>
        ),
        children: appRoutes(true),
      },
    ];
    const { user } = renderRoutes(routes, { services });
    const plate = await screen.findByLabelText("Plate");
    await waitFor(() => expect(services.drafts.getState().queryType).not.toBeNull());
    await settle();
    // The first character clicks the field (focus); the second is the keystroke alone.
    await user.type(plate, "Z");
    await settle();
    const before = commits;
    await user.keyboard("Y");
    await settle();
    expect(plate).toHaveValue("ZY");
    expect(commits - before).toBe(1);
  });
});
