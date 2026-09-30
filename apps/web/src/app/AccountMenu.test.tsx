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
