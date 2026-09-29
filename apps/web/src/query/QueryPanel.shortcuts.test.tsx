import { fireEvent, screen, within } from "@testing-library/react";
import { Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

async function openPanel() {
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  const routes = [
    {
      element: (
        <ClientSupportProvider clientSupported>
          <Outlet />
        </ClientSupportProvider>
      ),
      children: appRoutes(true),
    },
  ];
  const view = renderRoutes(routes, { services });
  await screen.findByLabelText("Plate");
  return view;
}

const polite = () => screen.getByTestId("announcer-polite");
const vehicle = () => screen.getByRole("button", { name: "Vehicle" });
const person = () => screen.getByRole("button", { name: "Person" });

/** user-event's default key map has no Slash; dispatch keydown on the focused element. */
function slash(shiftKey = false): void {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    code: "Slash",
    key: shiftKey ? "?" : "/",
    shiftKey,
  });
}

describe("FR-006 FR-007 shortcuts on the query panel (spec 6.4)", () => {
  it("typing a slash in the Plate input types it and fires nothing", async () => {
    const { user } = await openPanel();
    const plate = screen.getByLabelText("Plate");
    await user.click(plate);
    await user.keyboard("/");
    slash();
    slash(true);
    expect(plate).toHaveValue("/");
    expect(plate).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Alt+2 with focus in Plate selects PER", async () => {
    const { user } = await openPanel();
    await user.click(screen.getByLabelText("Plate"));
    await user.keyboard("{Alt>}2{/Alt}");
    expect(person()).toHaveAttribute("aria-pressed", "true");
    expect(vehicle()).toHaveAttribute("aria-pressed", "false");
  });

  it("a quick type slot with no configured type does nothing", async () => {
    const { user } = await openPanel();
    await user.keyboard("{Alt>}9{/Alt}");
    expect(vehicle()).toHaveAttribute("aria-pressed", "true");
  });

  it("Ctrl+Enter in an empty PER form takes the blocked-submit path", async () => {
    const { user } = await openPanel();
    await user.keyboard("{Alt>}2{/Alt}");
    person().focus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    const last = screen.getByLabelText(/Last name/);
    expect(last).toHaveAttribute("aria-invalid", "true");
    expect(last).toHaveFocus();
    expect(polite()).toHaveTextContent("1 field needs attention.");
  });

  it("G then Q with focus on the page body focuses the query-type select", async () => {
    const { user } = await openPanel();
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    await user.keyboard("gq");
    expect(screen.getByLabelText("Query type")).toHaveFocus();
  });

  it("Shift+/ opens the sheet listing submit with Ctrl+Enter; Escape closes it and focus returns", async () => {
    const { user } = await openPanel();
    vehicle().focus();
    slash(true);
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    const submit = within(dialog).getByText("Submit the query").closest("li") as HTMLElement;
    expect(within(submit).getByText("Ctrl + Enter")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(vehicle()).toHaveFocus();
  });

  it("spec 6.2: with the sheet open Alt+2 does not change the query type", async () => {
    const { user } = await openPanel();
    await user.click(screen.getByLabelText("Plate"));
    fireEvent.keyDown(document.body, { code: "Slash", key: "?", shiftKey: true });
    const sheet = screen.getByRole("dialog");
    fireEvent.keyDown(sheet, { code: "Digit2", key: "2", altKey: true });
    expect(vehicle()).toHaveAttribute("aria-pressed", "true");
    expect(person()).toHaveAttribute("aria-pressed", "false");
  });

  it("with the sheet closed, Escape is left to the page (not prevented)", async () => {
    await openPanel();
    const event = new KeyboardEvent("keydown", {
      code: "Escape",
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
