import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { Outlet } from "react-router";
import { describe, expect, it } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { API, CLIENT_CONFIG, server, TEST_USER } from "../test/msw-server.js";
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

/** user-event's default key map has no Backquote either. */
function ctrlBackquote(): void {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    code: "Backquote",
    key: "`",
    ctrlKey: true,
  });
}

/**
 * Shift+/ until the sheet opens. The panel and the provider register their key handlers in effects,
 * and findBy can resolve before those effects run when the suite is under load, so a single
 * synchronous press right after openPanel can land before anything listens.
 */
async function openSheet(target?: Element): Promise<HTMLElement> {
  return waitFor(() => {
    if (document.querySelector("dialog[open]") === null) {
      fireEvent.keyDown(target ?? document.activeElement ?? document.body, {
        code: "Slash",
        key: "?",
        shiftKey: true,
      });
    }
    return screen.getByRole("dialog", { name: "Keyboard shortcuts" });
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

  it("G then Q with focus on the page body focuses the pressed quick access button", async () => {
    const { user } = await openPanel();
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    await user.keyboard("gq");
    expect(screen.getByRole("button", { name: "Vehicle" })).toHaveFocus();
  });

  it("Shift+/ opens the sheet listing submit with Ctrl+Enter; Escape closes it and focus returns", async () => {
    const { user } = await openPanel();
    vehicle().focus();
    const dialog = await openSheet();
    const submit = within(dialog).getByText("Submit the query").closest("li") as HTMLElement;
    expect(within(submit).getByText("Ctrl + Enter")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(vehicle()).toHaveFocus();
  });

  it("spec 6.2: with the sheet open Alt+2 does not change the query type", async () => {
    const { user } = await openPanel();
    await user.click(screen.getByLabelText("Plate"));
    const sheet = await openSheet(document.body);
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

describe("FR-006 FR-050 terminal shortcuts (spec 6.4)", () => {
  it("/ outside inputs switches to terminal mode and focuses the command line; / inside it types a slash", async () => {
    const { user } = await openPanel();
    (document.activeElement as HTMLElement).blur();
    slash();
    const command = await screen.findByLabelText("Command");
    await waitFor(() => expect(command).toHaveFocus());
    await user.keyboard("/");
    slash();
    expect(command).toHaveValue("VEH/");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Ctrl+Backquote toggles the mode and keeps focus on the equivalent control", async () => {
    const { user } = await openPanel();
    await user.click(screen.getByLabelText("Plate"));
    ctrlBackquote();
    const command = await screen.findByLabelText("Command");
    await waitFor(() => expect(command).toHaveFocus());
    ctrlBackquote();
    await waitFor(() => expect(screen.getByLabelText("Plate")).toHaveFocus());
  });

  it("Ctrl+Enter in terminal mode submits the terminal form", async () => {
    const { user } = await openPanel();
    await user.click(screen.getByRole("button", { name: "Terminal mode" }));
    await user.type(screen.getByLabelText("Command"), ".ABC123{Control>}{Enter}{/Control}");
    await waitFor(() => expect(polite()).toHaveTextContent(/Vehicle query sent/));
  });
});

describe("FR-054 site terminal settings (example-ok: Ctrl+Slash, / delimiter)", () => {
  it("Ctrl+Slash focuses the command line and the site delimiter writes and reads the command", async () => {
    server.use(
      http.get(`${API}/api/v1/config`, () =>
        HttpResponse.json({
          ...CLIENT_CONFIG,
          terminal: { delimiter: "/" },
          shortcuts: { focusTerminal: { keys: "Ctrl+Slash", context: "global" } },
        }),
      ),
    );
    const { user } = await openPanel();
    await user.type(screen.getByLabelText("Plate"), "ZZ-0001");
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { code: "Slash", key: "/", ctrlKey: true });
    const command = await screen.findByLabelText("Command");
    await waitFor(() => expect(command).toHaveFocus());
    expect(command).toHaveValue("VEH/ZZ-0001");
    expect(screen.getByText(/such as VEH\/plate\/state/)).toBeInTheDocument();
  });
});
