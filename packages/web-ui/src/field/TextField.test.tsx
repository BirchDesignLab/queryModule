import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { TextField } from "./TextField.js";

function Controlled(props: { error?: string; description?: string; required?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <TextField
      id="login-email"
      label="Email"
      requiredText="required"
      type="email"
      value={value}
      onChange={setValue}
      {...props}
    />
  );
}

describe("UX-004 required indicator never relies on colour (spec 6.2)", () => {
  it("renders an aria-hidden asterisk, visually hidden text and aria-required", () => {
    render(<Controlled required />);
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("required").style.clipPath).toBe("inset(50%)");
  });
  it("omits required markup for optional fields", () => {
    render(<Controlled />);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-required");
    expect(screen.queryByText("*")).toBeNull();
  });
});

describe("FR-005 invalid state is linked by aria-describedby (spec 6.2)", () => {
  it("marks aria-invalid and describes by description then error", () => {
    render(<Controlled required description="Your work email" error="Email is required." />);
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "login-email-description login-email-error");
    expect(input).toHaveAccessibleDescription("Your work email Email is required.");
  });
  it("reports typed text through onChange", async () => {
    render(<Controlled />);
    const input = screen.getByLabelText("Email");
    await userEvent.type(input, "tester@querymodule.test");
    expect(input).toHaveValue("tester@querymodule.test");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});
