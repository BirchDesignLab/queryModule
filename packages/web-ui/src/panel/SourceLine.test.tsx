import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceLine } from "./SourceLine.js";

// T10-Q3 (#642): the one source status line, drawn by the request list and the admin preview.
describe("SourceLine", () => {
  it("says the status in words and hides the icon from assistive technology", () => {
    const { container } = render(<SourceLine tone="problem" text="State system: timed out" />);
    expect(screen.getByText("State system: timed out")).toBeInTheDocument();
    const icon = container.querySelector(".qm-source__icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveTextContent("!");
    expect(container.firstElementChild).toHaveClass("qm-source", "qm-source--problem");
  });

  it("shows the reason after the text, and nothing when there is none", () => {
    const { container, rerender } = render(
      <SourceLine tone="problem" text="State system: timed out" why="no answer in 10 s" />,
    );
    expect(container.querySelector(".qm-source__why")).toHaveTextContent("no answer in 10 s");
    rerender(<SourceLine tone="ok" text="State system: returned" />);
    expect(container.querySelector(".qm-source__why")).toBeNull();
    expect(container.querySelector(".qm-source__icon")).toHaveTextContent("✓");
  });
});
