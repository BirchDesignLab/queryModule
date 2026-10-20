import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModeSeg } from "./ModeSeg.js";

const props = { legend: "Entry mode", formLabel: "Form mode", terminalLabel: "Terminal mode" };

describe("FR-056 entry mode segmented control (form or terminal)", () => {
  it("is a labelled group of two aria-pressed buttons, exactly one pressed", () => {
    const { rerender } = render(<ModeSeg {...props} terminal={false} onSelect={() => {}} />);
    const group = screen.getByRole("group", { name: "Entry mode" });
    expect(group).toHaveClass("qm-seg");
    expect(screen.getByRole("button", { name: "Form mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Terminal mode" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(<ModeSeg {...props} terminal onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Form mode" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Terminal mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("selects the other mode on click and on Space, and ignores the pressed one", async () => {
    const onSelect = vi.fn();
    render(<ModeSeg {...props} terminal={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Form mode" }));
    expect(onSelect).not.toHaveBeenCalled();
    const terminal = screen.getByRole("button", { name: "Terminal mode" });
    await userEvent.click(terminal);
    terminal.focus();
    await userEvent.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("terminal");
  });

  it("draws an icon in each button and the terminal shortcut hint, with the names unchanged (mockup v6)", () => {
    render(
      <ModeSeg
        {...props}
        terminal={false}
        onSelect={() => {}}
        icons
        shortcut="Ctrl+`"
        keys="Control+`"
      />,
    );
    const form = screen.getByRole("button", { name: "Form mode" });
    const terminal = screen.getByRole("button", { name: "Terminal mode" });
    for (const button of [form, terminal]) {
      const svg = button.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
    const hint = terminal.querySelector("kbd");
    expect(hint).toHaveTextContent("Ctrl+`");
    expect(hint?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(terminal).toHaveAttribute("aria-keyshortcuts", "Control+`");
    expect(form.querySelector("kbd")).toBeNull();
  });

  it("draws no icons and no hint by default (the officer's control)", () => {
    render(<ModeSeg {...props} terminal={false} onSelect={() => {}} />);
    expect(document.querySelector(".qm-mode-seg svg")).toBeNull();
    expect(document.querySelector(".qm-mode-seg kbd")).toBeNull();
    expect(screen.getByRole("button", { name: "Terminal mode" })).not.toHaveAttribute(
      "aria-keyshortcuts",
    );
  });
});
