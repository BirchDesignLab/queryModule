import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectField } from "./SelectField.js";

const options = [
  { code: "A", label: "Alpha" },
  { code: "B", label: "Beta" },
];

describe("FR-001 SelectField primitive", () => {
  it("binds label, required state, description, error and tag", () => {
    render(
      <SelectField
        id="s"
        label="Pick"
        requiredText="required"
        required
        options={options}
        value=""
        onChange={() => {}}
        description="Help"
        error="Bad"
        tag="default"
      />,
    );
    const select = screen.getByLabelText(/Pick/);
    expect(select).toHaveAttribute("aria-required", "true");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAttribute("aria-describedby", "s-description s-error");
    expect(screen.getByText("default")).toBeInTheDocument();
  });
  it("reports the selected code", async () => {
    const onChange = vi.fn();
    render(
      <SelectField
        id="s"
        label="Pick"
        requiredText="required"
        options={options}
        value=""
        onChange={onChange}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Pick"), "B");
    expect(onChange).toHaveBeenCalledWith("B");
    expect(screen.getByLabelText("Pick")).not.toHaveAttribute("aria-required");
  });
});
