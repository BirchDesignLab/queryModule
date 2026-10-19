import { createTranslator } from "@querymodule/client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu.js";
import { I18nProvider } from "./i18n-context.js";

const EMAIL = "tester@example.test";

const USER = { role: "user" };

function menu(props: Partial<AccountMenuProps> = {}) {
  return (
    <I18nProvider translator={createTranslator("en", EN_BUNDLE)}>
      <AccountMenu
        email={EMAIL}
        themeMode="auto"
        onThemeChange={() => undefined}
        onSignOut={() => undefined}
        {...USER}
        {...props}
      />
    </I18nProvider>
  );
}

describe("focus repair B: the Keyboard shortcuts item leaves while it has focus (spec 6.4)", () => {
  it("moves focus to the account button when the item disappears under focus", async () => {
    const user = userEvent.setup();
    const { rerender } = render(menu({ onShowShortcuts: vi.fn() }));
    await user.click(screen.getByRole("button", { name: EMAIL }));
    const item = within(screen.getByRole("group", { name: "Account" })).getByRole("button", {
      name: "Keyboard shortcuts",
    });
    item.focus();
    expect(item).toHaveFocus();
    // The panel unmounts (the page has no sheet any more): the item goes, the menu stays open.
    rerender(menu({ onShowShortcuts: undefined }));
    expect(screen.queryByRole("button", { name: "Keyboard shortcuts" })).toBeNull();
    expect(screen.getByRole("button", { name: EMAIL })).toHaveFocus();
    // Focus repair does not close the disclosure.
    expect(screen.getByRole("group", { name: "Account" })).toBeInTheDocument();
  });

  it("leaves focus alone when another control in the menu has it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(menu({ onShowShortcuts: vi.fn() }));
    await user.click(screen.getByRole("button", { name: EMAIL }));
    const signOut = screen.getByRole("button", { name: "Sign out" });
    signOut.focus();
    rerender(menu({ onShowShortcuts: undefined }));
    expect(signOut).toHaveFocus();
  });

  it("leaves focus alone when it is outside the menu", async () => {
    const user = userEvent.setup();
    const { rerender } = render(menu({ onShowShortcuts: vi.fn() }));
    await user.click(screen.getByRole("button", { name: EMAIL }));
    const outside = document.createElement("button");
    document.body.append(outside);
    // The disclosure closes on focus outside; the item is gone with it, and nothing is stolen.
    outside.focus();
    rerender(menu({ onShowShortcuts: undefined }));
    expect(outside).toHaveFocus();
    outside.remove();
  });
});

describe("UX-014 the terminal layout control under Theme (FR-050, spec 6.2)", () => {
  async function open(props: Partial<AccountMenuProps>) {
    const user = userEvent.setup();
    render(menu(props));
    await user.click(screen.getByRole("button", { name: EMAIL }));
    return { user, panel: screen.getByRole("group", { name: "Account" }) };
  }

  it("is not offered where the page has no terminal pane (no handler)", async () => {
    const { panel } = await open({});
    expect(within(panel).queryByRole("group", { name: "Terminal" })).toBeNull();
  });

  it("offers In the panel and Beside results, the stored one pressed, with the width hint", async () => {
    const { panel } = await open({ terminal: "pane", onTerminalChange: vi.fn() });
    const group = within(panel).getByRole("group", { name: "Terminal" });
    expect(within(group).getByRole("button", { name: "In the panel" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const beside = within(group).getByRole("button", { name: "Beside results" });
    expect(beside).toHaveAttribute("aria-pressed", "true");
    expect(beside).toHaveAccessibleDescription(
      "Beside results needs a window 1280 px wide or more.",
    );
    expect(
      within(panel).getByText("Beside results needs a window 1280 px wide or more."),
    ).toBeVisible();
  });

  it("an unset layout reads In the panel", async () => {
    const { panel } = await open({ terminal: "toggle", onTerminalChange: vi.fn() });
    expect(within(panel).getByRole("button", { name: "In the panel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("a press reports the new choice, and the pressed one again reports nothing", async () => {
    const onTerminalChange = vi.fn();
    const { user, panel } = await open({ terminal: "toggle", onTerminalChange });
    await user.click(within(panel).getByRole("button", { name: "In the panel" }));
    expect(onTerminalChange).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole("button", { name: "Beside results" }));
    expect(onTerminalChange).toHaveBeenCalledExactlyOnceWith("pane");
  });

  it("a failed save shows an alert in the menu", async () => {
    const { panel } = await open({
      terminal: "toggle",
      onTerminalChange: vi.fn(),
      terminalSaveFailed: true,
    });
    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "Could not save the layout. It stays on In the panel.",
    );
  });

  it("a failed save that leaves the layout on Beside results says so (S2)", async () => {
    const { panel } = await open({
      terminal: "pane",
      onTerminalChange: vi.fn(),
      terminalSaveFailed: true,
    });
    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "Could not save the layout. It stays on Beside results.",
    );
  });

  it("shows no alert when the save did not fail", async () => {
    const { panel } = await open({ terminal: "toggle", onTerminalChange: vi.fn() });
    expect(within(panel).queryByRole("alert")).toBeNull();
  });
});
