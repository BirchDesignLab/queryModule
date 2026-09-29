import { resolveShortcuts } from "@querymodule/core/config";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutProvider, useShortcutAction } from "./ShortcutProvider.js";

function Action({ action, handler }: { action: string; handler: () => void }) {
  useShortcutAction(action, handler);
  return null;
}

/** user-event's default key map has no Slash; dispatch keydown on the focused element. */
function slash(): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { code: "Slash", key: "/" });
}

function setup(ui: ReactNode) {
  const user = userEvent.setup();
  render(<ShortcutProvider bindings={resolveShortcuts()}>{ui}</ShortcutProvider>);
  return user;
}

describe("FR-007 shortcut provider binds the engine to the DOM (spec 6.4)", () => {
  it("fires a global single key on the page body and calls preventDefault", async () => {
    const handler = vi.fn();
    setup(<Action action="focusTerminal" handler={handler} />);
    slash();
    expect(handler).toHaveBeenCalledTimes(1);
    const event = new KeyboardEvent("keydown", { code: "Slash", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("an action without a handler does nothing and is not prevented", () => {
    setup(<p>no handlers</p>);
    const event = new KeyboardEvent("keydown", { code: "Slash", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  const inputCases: [string, ReactNode][] = [
    ["input", <input key="i" aria-label="field" />],
    ["textarea", <textarea key="t" aria-label="field" />],
    [
      "select",
      <select key="s" aria-label="field">
        <option>a</option>
      </select>,
    ],
    [
      "contenteditable",
      // biome-ignore lint/a11y/useSemanticElements: contenteditable is the case under test
      <div key="c" role="textbox" tabIndex={0} contentEditable aria-label="field" />,
    ],
    [
      "inside [data-terminal]",
      <div key="d" data-terminal="">
        <button type="button">in terminal</button>
      </div>,
    ],
  ];
  it.each(inputCases)("a single key never fires in %s", async (_name, el) => {
    const handler = vi.fn();
    setup(
      <>
        <Action action="focusTerminal" handler={handler} />
        {el}
      </>,
    );
    const target =
      screen.queryByLabelText("field") ?? screen.getByRole("button", { name: "in terminal" });
    target.focus();
    slash();
    expect(handler).not.toHaveBeenCalled();
  });

  it("a single key still fires from a checkbox and a radio", async () => {
    const handler = vi.fn();
    setup(
      <>
        <Action action="focusTerminal" handler={handler} />
        <input type="checkbox" aria-label="box" />
        <input type="radio" aria-label="radio" />
      </>,
    );
    screen.getByLabelText("box").focus();
    slash();
    screen.getByLabelText("radio").focus();
    slash();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("an Alt combo fires inside a text input", async () => {
    const handler = vi.fn();
    const user = setup(
      <>
        <Action action="quickType2" handler={handler} />
        <input aria-label="field" />
      </>,
    );
    screen.getByLabelText("field").focus();
    await user.keyboard("{Alt>}2{/Alt}");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("panel-context bindings need an enclosing data-shortcut-context", async () => {
    const handler = vi.fn();
    const user = setup(
      <>
        <Action action="submit" handler={handler} />
        <button type="button">outside</button>
        <div data-shortcut-context="panel">
          <button type="button">inside</button>
        </div>
      </>,
    );
    screen.getByRole("button", { name: "outside" }).focus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(handler).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "inside" }).focus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+A never fires even when bound", async () => {
    const handler = vi.fn();
    const user = userEvent.setup();
    render(
      <ShortcutProvider bindings={{ submit: [{ keys: "Ctrl+KeyA", context: "global" }] }}>
        <Action action="submit" handler={handler} />
      </ShortcutProvider>,
    );
    await user.keyboard("{Control>}a{/Control}");
    expect(handler).not.toHaveBeenCalled();
  });

  it("a chord fires on the second stroke and expires after 1000 ms", async () => {
    const handler = vi.fn();
    const user = userEvent.setup();
    render(
      <ShortcutProvider bindings={resolveShortcuts()}>
        <Action action="goPanel" handler={handler} />
      </ShortcutProvider>,
    );
    await user.keyboard("gq");
    expect(handler).toHaveBeenCalledTimes(1);
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(10_000);
    await user.keyboard("g");
    now.mockReturnValue(11_000);
    await user.keyboard("q");
    expect(handler).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it("a handler registered later for the same action replaces the earlier one; unmount restores it", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <ShortcutProvider bindings={resolveShortcuts()}>
        <Action action="focusTerminal" handler={first} />
        <Action action="focusTerminal" handler={second} />
      </ShortcutProvider>,
    );
    slash();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    rerender(
      <ShortcutProvider bindings={resolveShortcuts()}>
        <Action action="focusTerminal" handler={first} />
      </ShortcutProvider>,
    );
    slash();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("the latest handler function wins across renders", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(
      <ShortcutProvider bindings={resolveShortcuts()}>
        <Action action="focusTerminal" handler={a} />
      </ShortcutProvider>,
    );
    rerender(
      <ShortcutProvider bindings={resolveShortcuts()}>
        <Action action="focusTerminal" handler={b} />
      </ShortcutProvider>,
    );
    slash();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("spec 6.2: while a modal dialog is open only dismiss fires; other actions are skipped", () => {
    const submit = vi.fn();
    const dismiss = vi.fn();
    setup(
      <main data-shortcut-context="panel">
        <Action action="submit" handler={submit} />
        <Action action="dismiss" handler={dismiss} />
        <dialog open aria-label="modal">
          <button type="button">inside</button>
        </dialog>
      </main>,
    );
    screen.getByRole("button", { name: "inside" }).focus();
    const ctrlEnter = new KeyboardEvent("keydown", {
      code: "Enter",
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement?.dispatchEvent(ctrlEnter);
    expect(submit).not.toHaveBeenCalled();
    expect(ctrlEnter.defaultPrevented).toBe(false);
    fireEvent.keyDown(document.activeElement ?? document.body, { code: "Escape", key: "Escape" });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
