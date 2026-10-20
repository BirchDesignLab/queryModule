import { LAYOUT_CONSTANTS } from "@querymodule/tokens";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { Outlet } from "react-router";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { ClientSupportProvider } from "../app/client-support-context.js";
import { appRoutes } from "../app/routes.js";
import { submitRecorder, TEST_USER } from "../test/msw-server.js";
import { renderRoutes, testServices } from "../test/render-routes.js";

const PANE_QUERY = `(min-width: ${LAYOUT_CONSTANTS["layout.terminalPane"]})`;

/** A window of the given width answers the pane query; a later change notifies the panel. */
function windowAt(initialWide: boolean) {
  const original = window.matchMedia;
  let wide = initialWide;
  const listeners = new Set<() => void>();
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return query === PANE_QUERY && wide;
      },
      media: query,
      addEventListener: (_type: string, cb: () => void) => {
        if (query === PANE_QUERY) listeners.add(cb);
      },
      removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
    }) as unknown as MediaQueryList;
  onTestFinished(() => {
    window.matchMedia = original;
  });
  return {
    resize(next: boolean) {
      wide = next;
      act(() => {
        for (const cb of listeners) cb();
      });
    },
  };
}

async function openPanel(options: {
  wide: boolean;
  terminal?: "toggle" | "pane" | null;
  persona?: string;
}) {
  const win = windowAt(options.wide);
  const services = testServices();
  services.authStore.getState().setSignedIn(TEST_USER);
  if (options.persona !== undefined)
    services.preferences.getState().setPersonaOverride(options.persona);
  if (options.terminal !== null && options.terminal !== undefined)
    services.preferences
      .getState()
      .setLayout({ orientation: "horizontal", terminal: options.terminal });
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
  return { ...view, win };
}

const pane = () => screen.getByRole("complementary", { name: "Terminal" });
const command = () => within(pane()).getByRole("textbox", { name: "Command" });
const plate = () => screen.getByLabelText("Plate");
/** Replaces the pane's command with `text`, typed key by key (the pane starts with the bare command). */
async function typeCommand(user: UserEvent, text: string) {
  await user.click(command());
  await user.clear(command());
  await user.keyboard(text);
}
const modeToggle = () => screen.queryByRole("button", { name: "Terminal mode" });

afterEach(() => {
  submitRecorder.calls.length = 0;
});

describe("FR-050 terminal beside the results (layout.terminal pane, spec 6.2)", () => {
  it("shows the terminal pane at a wide window: a Terminal region with the Command input, the form stays", async () => {
    await openPanel({ wide: true, terminal: "pane" });
    expect(pane()).toBeVisible();
    expect(within(pane()).getByRole("heading", { name: "Terminal" })).toBeVisible();
    expect(command()).toBeVisible();
    expect(plate()).toBeVisible();
    // The form, the requests, then the pane: the grid's three columns in reading order.
    const columns = Array.from(document.querySelector(".qm-panes")?.children ?? []).map((el) =>
      el.tagName.toLowerCase(),
    );
    expect(columns).toEqual(["div", "section", "aside"]);
  });

  it("lists the commands the site defines in a reference under the input", async () => {
    await openPanel({ wide: true, terminal: "pane" });
    const table = within(pane()).getByRole("table", { name: "Commands" });
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(1);
    expect(within(table).getAllByText(/^VEH/)[0]).toBeVisible();
  });

  it("says it is beside the results and that the command has no problems, until it has some", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    expect(within(pane()).getByText("Terminal is beside the results.")).toBeInTheDocument();
    expect(within(pane()).getByText("No problems.")).toBeInTheDocument();
    await typeCommand(user, "XYZ.1");
    await user.keyboard("{Enter}");
    expect(await within(pane()).findByText("Unrecognized command XYZ.")).toBeInTheDocument();
    expect(within(pane()).queryByText("No problems.")).not.toBeInTheDocument();
  });

  it("hides the Form and Terminal toggle in pane mode", async () => {
    await openPanel({ wide: true, terminal: "pane" });
    expect(modeToggle()).toBeNull();
    expect(screen.queryByRole("button", { name: "Form mode" })).toBeNull();
  });

  it("has no pane below the pane width: the toggle returns", async () => {
    await openPanel({ wide: false, terminal: "pane" });
    expect(screen.queryByRole("complementary", { name: "Terminal" })).toBeNull();
    expect(modeToggle()).toBeVisible();
  });

  it("has no pane when the preference is In the panel or unset, however wide", async () => {
    for (const terminal of ["toggle", null] as const) {
      const { unmount } = await openPanel({ wide: true, terminal });
      expect(screen.queryByRole("complementary", { name: "Terminal" })).toBeNull();
      expect(modeToggle()).toBeVisible();
      unmount();
    }
  });

  it("the officer layout is one column: no pane, whatever the preference and the width", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane", persona: "mobileUnit" });
    expect(screen.queryByRole("complementary", { name: "Terminal" })).toBeNull();
    expect(modeToggle()).toBeVisible();
    // The officer's bar offers no terminal choice either: it would change nothing there.
    await user.click(screen.getByRole("button", { name: TEST_USER.email }));
    const account = screen.getByRole("group", { name: "Account" });
    expect(within(account).queryByRole("group", { name: "Terminal" })).toBeNull();
  });

  it("a value typed in the form shows in the command, as it is typed", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await user.type(plate(), "ZZ-0001");
    expect(command()).toHaveValue("VEH.ZZ-0001");
  });

  it("a command typed in the pane fills the form, and the text stays exactly as typed", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await typeCommand(user, "VEH.ZZ-0002.OK");
    expect(plate()).toHaveValue("ZZ-0002");
    expect(command()).toHaveValue("VEH.ZZ-0002.OK");
    expect(screen.getByLabelText("State", { exact: true })).toHaveValue("OK");
  });

  it("a half-typed command is not rewritten under the user's hands", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await typeCommand(user, "VEH.ZZ-");
    expect(command()).toHaveValue("VEH.ZZ-");
    await user.keyboard("0003");
    expect(command()).toHaveValue("VEH.ZZ-0003");
    expect(plate()).toHaveValue("ZZ-0003");
  });

  it("a command for another type selects that type in the form", async () => {
    const { user, services } = await openPanel({ wide: true, terminal: "pane" });
    await typeCommand(user, "PER.DOE");
    await waitFor(() => expect(services.drafts.getState().queryType).toBe("PER"));
    expect(screen.getByRole("button", { name: "Person" })).toHaveAttribute("aria-pressed", "true");
  });

  it("picking a quick-access type writes that type's command into the pane", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await user.type(plate(), "ZZ-0004");
    await user.click(screen.getByRole("button", { name: "Person" }));
    await waitFor(() => expect((command() as HTMLInputElement).value).toMatch(/^PER/));
  });

  it("lists the command problems under the pane input, and the form is untouched", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await user.type(plate(), "ZZ-0005");
    await typeCommand(user, "VAX.1{Enter}");
    const errors = within(pane()).getByRole("list", { name: "Command problems" });
    expect(errors).toHaveTextContent("Unrecognized command VAX.");
    expect(command()).toHaveAttribute("aria-invalid", "true");
    expect(command()).toHaveFocus();
    expect(plate()).toHaveValue("ZZ-0005");
    expect(submitRecorder.calls).toHaveLength(0);
  });

  it("Enter in the pane input runs the command with the shared draft", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await typeCommand(user, "VEH.ZZ-0006{Enter}");
    await waitFor(() => expect(submitRecorder.calls).toHaveLength(1));
    expect(submitRecorder.calls[0]?.body).toMatchObject({
      queryType: "VEH",
      values: { plate: "ZZ-0006" },
    });
    // The run went out from the pane: focus stays in its input.
    expect(command()).toHaveFocus();
  });

  it("the terminal shortcut focuses the pane input, and the command preview edit does the same", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    // A plain key types in an input, so the shortcut is pressed from outside one.
    screen.getByRole("heading", { name: "Query Module" }).focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { code: "Slash", key: "/" });
    await waitFor(() => expect(command()).toHaveFocus());
    expect(modeToggle()).toBeNull();
    await user.type(plate(), "ZZ-0007");
    await user.click(screen.getByRole("button", { name: "Edit in terminal pane" }));
    expect(command()).toHaveFocus();
  });

  it("the toggle shortcut moves focus between the form and the pane input", async () => {
    await openPanel({ wide: true, terminal: "pane" });
    plate().focus();
    const press = () =>
      fireEvent.keyDown(document.activeElement ?? document.body, {
        code: "Backquote",
        key: "`",
        ctrlKey: true,
      });
    press();
    await waitFor(() => expect(command()).toHaveFocus());
    press();
    await waitFor(() => expect(plate()).toHaveFocus());
  });

  it("narrowing the window brings the toggle back with the draft intact", async () => {
    const { user, win } = await openPanel({ wide: true, terminal: "pane" });
    await typeCommand(user, "VEH.ZZ-0008.OK");
    win.resize(false);
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Terminal" })).toBeNull(),
    );
    expect(modeToggle()).toBeVisible();
    expect(plate()).toHaveValue("ZZ-0008");
    await user.click(screen.getByRole("button", { name: "Terminal mode" }));
    expect(screen.getByRole("textbox", { name: "Command" })).toHaveValue("VEH.ZZ-0008.OK");
  });

  it("widening the window from terminal mode moves the typed command into the form", async () => {
    const { user, win, services } = await openPanel({ wide: false, terminal: "pane" });
    await user.click(screen.getByRole("button", { name: "Terminal mode" }));
    const input = screen.getByRole("textbox", { name: "Command" });
    await user.clear(input);
    await user.type(input, "VEH.ZZ-0009");
    win.resize(true);
    await waitFor(() => expect(pane()).toBeVisible());
    expect(services.drafts.getState().mode).toBe("form");
    expect(plate()).toHaveValue("ZZ-0009");
    expect(command()).toHaveValue("VEH.ZZ-0009");
    expect(modeToggle()).toBeNull();
  });

  it("narrowing with focus in the pane input moves focus to the form's first field (C1, spec 6.6)", async () => {
    const { user, win } = await openPanel({ wide: true, terminal: "pane" });
    await user.click(command());
    expect(command()).toHaveFocus();
    win.resize(false);
    await waitFor(() => expect(plate()).toHaveFocus());
  });

  it("widening with focus in the panel's command input moves focus to the pane input (C1, spec 6.6)", async () => {
    const { user, win } = await openPanel({ wide: false, terminal: "pane" });
    await user.click(screen.getByRole("button", { name: "Terminal mode" }));
    await user.click(screen.getByRole("textbox", { name: "Command" }));
    expect(screen.getByRole("textbox", { name: "Command" })).toHaveFocus();
    win.resize(true);
    await waitFor(() => expect(command()).toHaveFocus());
  });

  it("a resize leaves focus alone when it was not in the command input (C1)", async () => {
    const { user, win } = await openPanel({ wide: true, terminal: "pane" });
    await user.click(plate());
    win.resize(false);
    await waitFor(() => expect(modeToggle()).toBeVisible());
    expect(plate()).toHaveFocus();
  });

  it("an acknowledged run starts the draft over and the command with it", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await typeCommand(user, "VEH.ZZ-0012{Enter}");
    await waitFor(() => expect(submitRecorder.calls).toHaveLength(1));
    await waitFor(() => expect(plate()).toHaveValue(""));
    await waitFor(() => expect(command()).toHaveValue("VEH"));
  });

  it("the command reference is a keyboard-reachable scroll region with a name (#767, spec 6.4)", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    const region = within(pane()).getByRole("region", { name: "Command reference" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("table", { name: "Commands" })).toBeVisible();
    // Tab from the command input reaches it (the pane's next stop).
    await user.click(command());
    await user.tab();
    expect(region).toHaveFocus();
  });

  it("the polite announcement for an unknown code has no typed text; the visible error keeps it (#767, spec 6.7)", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await typeCommand(user, "XYZ.123{Enter}");
    expect(await within(pane()).findByRole("list", { name: "Command problems" })).toHaveTextContent(
      "Unrecognized command XYZ.",
    );
    const polite = screen.getByTestId("announcer-polite");
    await waitFor(() => expect(polite).toHaveTextContent("Unrecognized command"));
    expect(polite.textContent).not.toContain("XYZ");
    expect(polite.textContent).not.toContain("123");
  });

  it("other problems keep the count line in the announcement (#767)", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    // Known code with a value it cannot take: not an unknown command.
    await typeCommand(user, "VEH.A.B.C.D.E.F{Enter}");
    await within(pane()).findByRole("list", { name: "Command problems" });
    const polite = screen.getByTestId("announcer-polite");
    await waitFor(() => expect(polite).toHaveTextContent(/problems? with the command./));
    expect(polite.textContent).not.toContain("Unrecognized command");
  });

  // Mock data only. Each text is accepted by the parser but is not the canonical form the form
  // would write back, so a rewrite on entering the pane would show.
  it.each([
    ["VEH.ZZ-0001.state=OK", "VEH", "ZZ-0001"],
    ["veh.zz-0001", "VEH", "zz-0001"],
    ["VEH.ZZ-0001.OK.", "VEH", "ZZ-0001"],
    ["VEH.ZZ-0001..2026", "VEH", "ZZ-0001"],
    ["  VEH.ZZ-0001", "VEH", "ZZ-0001"],
    ["per.doe", "PER", null],
  ])(
    "entering pane mode keeps the command text as typed in the panel's terminal: %j (#767, spec 6.7)",
    async (typed, queryType, plateValue) => {
      const { user, services } = await openPanel({ wide: true, terminal: "toggle" });
      await user.click(screen.getByRole("button", { name: "Terminal mode" }));
      const input = screen.getByRole("textbox", { name: "Command" });
      await user.clear(input);
      await user.type(input, typed);
      // The account menu's pick: the layout becomes pane, and the window is wide.
      act(() => {
        services.preferences.getState().setLayout({ orientation: "horizontal", terminal: "pane" });
      });
      await waitFor(() => expect(pane()).toBeVisible());
      // One draft: the form holds what the command read, and the command is not rewritten from it.
      await waitFor(() => expect(services.drafts.getState().queryType).toBe(queryType));
      if (plateValue !== null) expect(plate()).toHaveValue(plateValue);
      expect(command()).toHaveValue(typed);
      expect(services.drafts.getState().mode).toBe("form");
    },
  );

  it("clearing the form clears the command back to the bare command", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await user.type(plate(), "ZZ-0010");
    expect(command()).toHaveValue("VEH.ZZ-0010");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(plate()).toHaveValue("");
    await waitFor(() => expect(command()).toHaveValue("VEH"));
  });

  it("keeps the typed values and the command in memory only (spec 6.7)", async () => {
    const { user } = await openPanel({ wide: true, terminal: "pane" });
    await user.type(plate(), "ZZ-0011");
    expect(JSON.stringify({ ...localStorage })).not.toContain("ZZ-0011");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("ZZ-0011");
  });
});

describe("#835 the pane frame (mockup v6 tpane)", () => {
  it("has no visible page title above the columns; the heading stays for the outline", async () => {
    await openPanel({ wide: true, terminal: "pane" });
    const title = screen.getByRole("heading", { level: 1, name: "Query Module" });
    expect(title.style.clipPath).toBe("inset(50%)");
    expect(title).toHaveAttribute("tabindex", "-1");
  });

  it("keeps the page title visible in the toggle layout", async () => {
    await openPanel({ wide: true, terminal: "toggle" });
    expect(screen.getByRole("heading", { level: 1, name: "Query Module" }).style.clipPath).toBe("");
  });

  it("the reference is a table of commands and their positions, one row per query type", async () => {
    await openPanel({ wide: true, terminal: "pane" });
    const table = within(pane()).getByRole("table", { name: "Commands" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(0);
    const veh = rows.find((r) => within(r).getByRole("rowheader").textContent?.startsWith("VEH"));
    expect(veh).toBeDefined();
    // Positions only, joined by the delimiter: the code is in the row header.
    expect(within(veh as HTMLElement).getByRole("cell")).toHaveTextContent(/^\.Plate\./);
    // The type the row runs is read with its codes.
    expect(within(veh as HTMLElement).getByRole("rowheader")).toHaveTextContent(/Vehicle/);
  });

  it("shows the Command label as a caption with a > prompt", async () => {
    await openPanel({ wide: true, terminal: "pane" });
    expect(pane().querySelector(`label[for="${command().id}"]`)).toHaveClass("qm-caption");
    expect(pane().querySelector(".qm-terminal__prompt")).toHaveTextContent(">");
  });
});
