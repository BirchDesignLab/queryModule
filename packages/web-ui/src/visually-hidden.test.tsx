import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VisuallyHidden } from "./visually-hidden";

afterEach(cleanup);

describe("FR-005 visually hidden text (spec 6.2 required indicator)", () => {
  it("stays in the accessibility tree", () => {
    render(
      <label htmlFor="plate">
        Plate <VisuallyHidden>required</VisuallyHidden>
        <input id="plate" />
      </label>,
    );
    expect(screen.getByRole("textbox", { name: /Plate\s+required/ })).toBeTruthy();
  });

  it("is clipped out of view through inline CSSOM styles, not a stylesheet", () => {
    render(<VisuallyHidden>required</VisuallyHidden>);
    const el = screen.getByText("required");
    expect(el.style.position).toBe("absolute");
    expect(el.style.width).toBe("1px");
    expect(el.style.overflow).toBe("hidden");
    expect(el.style.clipPath).toBe("inset(50%)");
  });
});
