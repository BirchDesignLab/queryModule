import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegField } from "./SegField.js";

const options = [
  { code: "BOAT", label: "Boat" },
  { code: "ARTICLE", label: "Article" },
];
const base = { id: "qp-propertyType", label: "Property type", requiredText: "required", options };

describe("subtype segmented control (visual system: controls and states)", () => {
  it("is a group named by its legend with one radio per option, the value checked", () => {
    render(<SegField {...base} required value="ARTICLE" onChange={() => undefined} />);
    const group = screen.getByRole("group", { name: /Property type/ });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("value")),
    ).toEqual(["BOAT", "ARTICLE"]);
    expect(screen.getByRole("radio", { name: "Article" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Boat" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Boat" })).toBeRequired();
    expect(within(group).getByText("required")).toBeInTheDocument();
  });
  it("reports the chosen code", async () => {
    const onChange = vi.fn();
    render(<SegField {...base} value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Boat" }));
    expect(onChange).toHaveBeenCalledWith("BOAT");
  });
  it("marks every radio invalid and describes the group with the error", () => {
    render(<SegField {...base} value="" error="Property type is required." onChange={() => {}} />);
    for (const r of screen.getAllByRole("radio")) expect(r).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("group", { name: /Property type/ })).toHaveAccessibleDescription(
      "Property type is required.",
    );
  });
  it("arrow keys move the choice inside the group", async () => {
    const onChange = vi.fn();
    render(<SegField {...base} value="BOAT" onChange={onChange} />);
    screen.getByRole("radio", { name: "Boat" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("ARTICLE");
  });
});
