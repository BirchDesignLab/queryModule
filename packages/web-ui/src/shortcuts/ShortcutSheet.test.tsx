import { resolveShortcuts } from "@querymodule/core/config";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ShortcutSheet } from "./ShortcutSheet.js";

const MESSAGES: Record<string, string> = {
  "shortcut.sheetTitle": "Keyboard shortcuts",
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
    expect(within(chord).getByText("g")).toBeInTheDocument();
    expect(within(chord).getByText("q")).toBeInTheDocument();
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
});
