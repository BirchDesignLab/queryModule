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
});
