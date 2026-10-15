import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { ACK_202, API, server, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

// G31 (demo dry run): in terminal mode the panel names the query the command line holds, and the
// request is listed as it was typed (NAM stays NAM). The parser is untouched.

async function openTerminal() {
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  const view = renderRoutes(
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
  await view.user.click(screen.getByRole("button", { name: "Terminal mode" }));
  return { ...view, services };
}

describe("G31 terminal mode names what is typed", () => {
  it("the panel heading follows the type the command line names, and goes back when it names none", async () => {
    const { user } = await openTerminal();
    const input = screen.getByRole("textbox", { name: "Command" });
    expect(screen.getByRole("heading", { level: 2, name: "Vehicle query" })).toBeVisible();
    await user.clear(input);
    await user.type(input, "PRO.ZZ123.FIREARM");
    expect(screen.getByRole("heading", { level: 2, name: "Property query" })).toBeVisible();
    // The pressed quick-access button agrees with the heading (one type state, as in mockup v5).
    const quick = screen.getByRole("group", { name: "Quick access" });
    expect(within(quick).getByRole("button", { name: /Property/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(quick).getByRole("button", { name: /Vehicle/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.clear(input);
    await user.type(input, "XYZ");
    expect(screen.getByRole("heading", { level: 2, name: "Vehicle query" })).toBeVisible();
  });

  it("a request typed as NAM is listed as NAM, not rebuilt as PER", async () => {
    server.use(
      http.post(`${API}/api/v1/queries`, () => HttpResponse.json(ACK_202, { status: 202 })),
    );
    const { user } = await openTerminal();
    const input = screen.getByRole("textbox", { name: "Command" });
    await user.clear(input);
    await user.type(input, "NAM.TESTERSON.SAMPLE{Enter}");
    const region = await screen.findByRole("region", { name: "Requests this shift" });
    await waitFor(() => expect(within(region).getAllByRole("listitem")).toHaveLength(1));
    expect(within(region).getByText("NAM.TESTERSON.SAMPLE")).toBeInTheDocument();
  });
});
