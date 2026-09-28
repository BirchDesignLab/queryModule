import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CheckboxField } from "./CheckboxField.js";

describe("FR-001 CheckboxField primitive", () => {
  it("binds label, required state, description, error and tag", () => {
    render(
      <CheckboxField
        id="c"
        label="Flag"
        requiredText="required"
        required
        checked={false}
        onChange={() => {}}
        description="Help"
        error="Bad"
        tag="default"
      />,
    );
    const box = screen.getByRole("checkbox", { name: /Flag/ });
    expect(box).toHaveAttribute("aria-required", "true");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAttribute("aria-describedby", "c-description c-error");
    expect(screen.getByText("default")).toBeInTheDocument();
  });
  it("reports the checked state", async () => {
    const onChange = vi.fn();
    render(
      <CheckboxField id="c" label="Flag" requiredText="required" checked onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole("checkbox")).not.toHaveAttribute("aria-required");
  });
});
