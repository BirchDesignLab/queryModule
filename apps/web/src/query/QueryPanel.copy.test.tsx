import { screen, waitFor } from "@testing-library/react";
import { Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

// Demo dry run copy gaps on the live panel: G28 (empty list), G29 (the source deadline has a label).

describe("panel copy", () => {
  it("G28/G29: the empty list talks about answers, and a source chip says its 10 s is a limit", async () => {
    const services = testServices();
    services.authStore.getState().setSignedIn(TEST_USER);
    renderRoutes(
      [
        {
          element: (
            <ClientSupportProvider clientSupported>
              <Outlet />
            </ClientSupportProvider>
          ),
          children: appRoutes(true),
        },
      ],
      { services },
    );
    await screen.findByLabelText("Plate");
    await waitFor(() => expect(services.drafts.getState().queryType).not.toBeNull());
    expect(
      screen.getByText("No requests yet this shift. Run a query and its answers appear here."),
    ).toBeVisible();
    expect(screen.getAllByText("10 s limit").length).toBeGreaterThan(0);
  });
});
