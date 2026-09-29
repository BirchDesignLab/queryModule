import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActionBar } from "./ActionBar.js";

describe("panel action bar (visual system)", () => {
  it("holds the primary action, Clear and the status line in that order", async () => {
    const onClear = vi.fn();
    const { container } = render(
      <ActionBar clearLabel="Clear" onClear={onClear} status="2 fields need attention.">
        <button type="submit">Run query</button>
      </ActionBar>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Run query", "Clear"]);
    expect(screen.getByText("2 fields need attention.")).toBeVisible();
    expect(container.querySelector("[aria-live],[role=status],[role=alert]")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
