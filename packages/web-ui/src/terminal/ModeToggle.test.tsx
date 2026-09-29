import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModeToggle } from "./ModeToggle.js";

describe("FR-050 mode toggle", () => {
  it("reflects pressed through aria-pressed", () => {
    const { rerender } = render(
      <ModeToggle pressed={false} label="Terminal" onToggle={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(<ModeToggle pressed label="Terminal" onToggle={() => {}} />);
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("calls onToggle on click and on Space", async () => {
    const onToggle = vi.fn();
    render(<ModeToggle pressed={false} label="Terminal" onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Terminal" });
    await userEvent.click(button);
    button.focus();
    await userEvent.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
