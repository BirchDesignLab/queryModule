import { resolveShortcuts } from "@querymodule/core/config";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutSheet } from "./ShortcutSheet.js";

const MESSAGES: Record<string, string> = {
  "shortcut.sheetTitle": "Keyboard shortcuts",
  "shortcut.close": "Close",
  "shortcut.then": "then",
  "shortcut.action.quickAccessType": "Quick access: {type}",
  "shortcut.action.submit": "Submit the query",
  "shortcut.action.focusTerminal": "Go to the command line",
  "shortcut.action.goPanel": "Go to the query panel",
  "shortcut.context.global": "Anywhere",
  "shortcut.context.panel": "Query panel",
};
const t = (key: string) => MESSAGES[key] ?? key;

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      <ShortcutSheet
        open={open}
        onClose={() => setOpen(false)}
        bindings={resolveShortcuts()}
        t={t}
      />
    </>
  );
}

const row = (dialog: HTMLElement, label: string) =>
  within(dialog).getByText(label).closest("li") as HTMLElement;

describe("UX-004 shortcut sheet (spec 6.2 dialogs, 6.4)", () => {
  it("is a labelled modal dialog listing action, keys and context", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "opener" }));
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    const submit = row(dialog, "Submit the query");
    expect(within(submit).getByText("Ctrl+Enter")).toBeInTheDocument();
    expect(within(submit).getByText("Query panel")).toBeInTheDocument();
    const terminal = row(dialog, "Go to the command line");
    expect(within(terminal).getByText("/")).toBeInTheDocument();
    expect(within(terminal).getByText("Anywhere")).toBeInTheDocument();
    const chord = row(dialog, "Go to the query panel");
    expect(within(chord).getByText("G")).toBeInTheDocument();
    expect(within(chord).getByText("then")).toBeInTheDocument();
    expect(within(chord).getByText("Q")).toBeInTheDocument();
  });

  it("lists every binding of an action that has several", () => {
    render(
      <ShortcutSheet
        open
        onClose={() => undefined}
        bindings={{
          submit: [
            { keys: "Ctrl+Enter", context: "panel" },
            { keys: "F5", context: "global" },
          ],
        }}
        t={t}
      />,
    );
    expect(screen.getByText("Ctrl+Enter")).toBeInTheDocument();
    expect(screen.getByText("F5")).toBeInTheDocument();
  });

  it("the native cancel event closes it and focus returns to the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "opener" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog");
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await Promise.resolve();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
  it("has a focusable Close button that closes it and returns focus (axe scrollable-region-focusable)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "opener" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
  it("calls onClose exactly once when closed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <ShortcutSheet open={true} onClose={onClose} bindings={resolveShortcuts()} t={t} />,
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    rerender(<ShortcutSheet open={false} onClose={onClose} bindings={resolveShortcuts()} t={t} />);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("focus repair A: an opener that left the page (spec 6.4 focus is never lost)", () => {
  function DetachedHarness({ withFallback }: { withFallback: boolean }) {
    const [open, setOpen] = useState(false);
    const [openerShown, setOpenerShown] = useState(true);
    return (
      <>
        {openerShown ? (
          <button type="button" onClick={() => setOpen(true)}>
            opener
          </button>
        ) : null}
        <button type="button" onClick={() => setOpenerShown(false)}>
          remove opener
        </button>
        <button type="button">fallback</button>
        <ShortcutSheet
          open={open}
          onClose={() => setOpen(false)}
          bindings={resolveShortcuts()}
          t={t}
          returnFocus={
            withFallback ? () => screen.getByRole("button", { name: "fallback" }) : undefined
          }
        />
      </>
    );
  }

  it("returns focus to the fallback when the opener was removed while the sheet was open", async () => {
    const user = userEvent.setup();
    render(<DetachedHarness withFallback />);
    await user.click(screen.getByRole("button", { name: "opener" }));
    const dialog = screen.getByRole("dialog");
    // The opener leaves the page while the modal is open (a persona flip remounts the menu).
    act(() => screen.getByRole("button", { name: "remove opener" }).click());
    expect(screen.queryByRole("button", { name: "opener" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "fallback" })).toHaveFocus();
  });

  it("still prefers the opener when it is connected, even with a fallback", async () => {
    const user = userEvent.setup();
    render(<DetachedHarness withFallback />);
    const opener = screen.getByRole("button", { name: "opener" });
    await user.click(opener);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(opener).toHaveFocus();
  });

  it("without a fallback nothing else takes focus (unchanged behaviour)", async () => {
    const user = userEvent.setup();
    render(<DetachedHarness withFallback={false} />);
    await user.click(screen.getByRole("button", { name: "opener" }));
    const dialog = screen.getByRole("dialog");
    act(() => screen.getByRole("button", { name: "remove opener" }).click());
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "fallback" })).not.toHaveFocus();
  });
});

describe("G9 closing the sheet never leaves focus on the page body", () => {
  it("uses the fallback when the sheet was opened with nothing focused (a shortcut from the bare page)", async () => {
    const user = userEvent.setup();
    function BareHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)} tabIndex={-1}>
            hidden opener
          </button>
          <button type="button">fallback</button>
          <ShortcutSheet
            open={open}
            onClose={() => setOpen(false)}
            bindings={resolveShortcuts()}
            t={t}
            returnFocus={() => screen.getByRole("button", { name: "fallback" })}
          />
        </>
      );
    }
    render(<BareHarness />);
    // Open with focus on the body, as the Shift+Slash shortcut does on a freshly loaded page.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    screen.getByRole("button", { name: "hidden opener" }).click();
    const close = await screen.findByRole("button", { name: "Close" });
    await user.click(close);
    expect(screen.getByRole("button", { name: "fallback" })).toHaveFocus();
  });
});

describe("G8 key names a person can read", () => {
  it("names the arrow, Escape and Delete keys in words, with no layout map", () => {
    render(
      <ShortcutSheet
        open
        onClose={() => undefined}
        bindings={{
          selectPrev: [{ keys: "ArrowUp", context: "results" }],
          selectNext: [{ keys: "ArrowDown", context: "results" }],
          dismiss: [{ keys: "Escape", context: "global" }],
          deleteFromView: [{ keys: "Delete", context: "results" }],
        }}
        t={t}
      />,
    );
    expect(screen.getByText("Up arrow")).toBeInTheDocument();
    expect(screen.getByText("Down arrow")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("R5: names the keys as a person reads them, never as an event code", () => {
    render(
      <ShortcutSheet
        open
        onClose={() => undefined}
        bindings={{
          focusTerminal: [{ keys: "Slash", context: "global" }],
          shortcutSheet: [{ keys: "Shift+Slash", context: "global" }],
          toggleMode: [{ keys: "Ctrl+Backquote", context: "global" }],
          quickType1: [{ keys: "Alt+Digit1", context: "global" }],
          goPanel: [{ keys: "KeyG KeyQ", context: "global" }],
        }}
        t={t}
      />,
    );
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(screen.getByText("Shift+/")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+`")).toBeInTheDocument();
    expect(screen.getByText("Alt+1")).toBeInTheDocument();
    expect(screen.getByText("G")).toBeInTheDocument();
    expect(screen.getByText("Q")).toBeInTheDocument();
    for (const code of ["Slash", "Backquote", "Digit1", "KeyG", "KeyQ"]) {
      expect(screen.queryByText(new RegExp(code))).toBeNull();
    }
  });

  it("R5: an actionLabel names a row by what it does, and the generic label stays for the rest", () => {
    render(
      <ShortcutSheet
        open
        onClose={() => undefined}
        bindings={{
          quickType1: [{ keys: "Alt+Digit1", context: "global" }],
          submit: [{ keys: "Ctrl+Enter", context: "panel" }],
        }}
        t={t}
        actionLabel={(action) => (action === "quickType1" ? "Quick access: Vehicle" : undefined)}
      />,
    );
    expect(screen.getByText("Quick access: Vehicle")).toBeInTheDocument();
    expect(screen.getByText("Submit the query")).toBeInTheDocument();
  });
});

describe("FR-006 shortcut sheet key labels (spec 6.4, #313)", () => {
  const setKeyboard = (value: unknown) =>
    Object.defineProperty(navigator, "keyboard", { configurable: true, value });
  afterEach(() => {
    Reflect.deleteProperty(navigator, "keyboard");
  });
  const bindings = {
    toggleMode: [{ keys: "Ctrl+Backquote", context: "global" }],
    goPanel: [{ keys: "KeyG KeyQ", context: "global" }],
  } as const;
  const sheet = () => <ShortcutSheet open onClose={() => undefined} bindings={bindings} t={t} />;

  it(
    "renders combos with every modifier joined by " +
      " and the readable key when no layout map exists",
    () => {
      render(sheet());
      expect(screen.getByText("Ctrl+`")).toBeInTheDocument();
      expect(screen.queryByText("Ctrl+Backquote")).not.toBeInTheDocument();
    },
  );

  it("shows the name of a key with no other label (F5) when no layout map exists", () => {
    render(
      <ShortcutSheet
        open
        onClose={() => undefined}
        bindings={{ submit: [{ keys: "Ctrl+Alt+Shift+F5", context: "global" }] }}
        t={t}
      />,
    );
    expect(screen.getByText("Ctrl+Alt+Shift+F5")).toBeInTheDocument();
  });

  it("renders the fallback immediately, then swaps in the layout map's labels", async () => {
    let resolve: (m: ReadonlyMap<string, string>) => void = () => undefined;
    setKeyboard({
      getLayoutMap: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    render(sheet());
    expect(screen.getByText("Ctrl+`")).toBeInTheDocument();
    resolve(
      new Map([
        ["Backquote", "²"],
        ["KeyG", "g"],
        ["KeyQ", "a"],
      ]),
    );
    expect(await screen.findByText("Ctrl+²")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("falls back when the layout map rejects", async () => {
    const getLayoutMap = vi.fn().mockRejectedValue(new Error("SecurityError"));
    setKeyboard({ getLayoutMap });
    render(sheet());
    await vi.waitFor(() => expect(getLayoutMap).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Ctrl+`")).toBeInTheDocument();
  });

  it("falls back when getLayoutMap throws synchronously", () => {
    setKeyboard({
      getLayoutMap: () => {
        throw new Error("nope");
      },
    });
    render(sheet());
    expect(screen.getByText("Ctrl+`")).toBeInTheDocument();
  });

  it("falls back to the key's readable name for a code the layout map does not carry", async () => {
    setKeyboard({ getLayoutMap: () => Promise.resolve(new Map([["KeyQ", "a"]])) });
    render(
      <ShortcutSheet
        open
        onClose={() => undefined}
        bindings={{ ...bindings, focusTerminal: [{ keys: "Slash", context: "global" }] }}
        t={t}
      />,
    );
    // The map has resolved once a mapped key shows its layout label (a capital of the map's "a").
    expect(await screen.findByText("A")).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(screen.queryByText("Slash")).not.toBeInTheDocument();
    expect(screen.getByText("Ctrl+`")).toBeInTheDocument();
  });

  it("with a layout map, Shift+Slash reads 'Shift+/': the map gives the unshifted character", async () => {
    setKeyboard({ getLayoutMap: () => Promise.resolve(new Map([["Slash", "/"]])) });
    render(
      <ShortcutSheet
        open
        onClose={() => undefined}
        bindings={{ openShortcuts: [{ keys: "Shift+Slash", context: "global" }] }}
        t={t}
      />,
    );
    expect(await screen.findByText("Shift+/")).toBeInTheDocument();
    expect(screen.queryByText("?")).not.toBeInTheDocument();
  });

  it("asks for the layout map once per mount, not on every open (#319)", async () => {
    const getLayoutMap = vi.fn().mockResolvedValue(new Map([["KeyQ", "a"]]));
    setKeyboard({ getLayoutMap });
    const props = { onClose: () => undefined, bindings, t };
    const { rerender } = render(<ShortcutSheet open {...props} />);
    expect(await screen.findByText("A")).toBeInTheDocument();
    rerender(<ShortcutSheet open={false} {...props} />);
    rerender(<ShortcutSheet open {...props} />);
    expect(await screen.findByText("A")).toBeInTheDocument();
    expect(getLayoutMap).toHaveBeenCalledTimes(1);
  });

  it("does not ask for the layout map while the sheet was never opened", () => {
    const getLayoutMap = vi.fn().mockResolvedValue(new Map());
    setKeyboard({ getLayoutMap });
    render(<ShortcutSheet open={false} onClose={() => undefined} bindings={bindings} t={t} />);
    expect(getLayoutMap).not.toHaveBeenCalled();
  });
});
