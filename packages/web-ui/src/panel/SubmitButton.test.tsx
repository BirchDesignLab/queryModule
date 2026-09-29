import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { SubmitButton } from "./SubmitButton.js";

const LABELS: Record<string, string> = {
  "form.submit": "Submit",
  "form.submitting": "Submitting",
  "form.noConnection": "No connection to server",
  "form.updateRequired": "Client update required",
  "form.preview": "Preview",
};
const t = (key: string) => LABELS[key] ?? key;

function renderInForm(reason: "submitting" | "noConnection" | "updateRequired" | "preview" | null) {
  const onSubmit = vi.fn((e: FormEvent) => e.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <input aria-label="Field" />
      <SubmitButton id="qp-submit" reason={reason} t={t} />
    </form>,
  );
  return onSubmit;
}

describe("FR-006 submit button (spec 6.2)", () => {
  it("is a plain enabled submit button when there is no reason", async () => {
    const onSubmit = renderInForm(null);
    const button = screen.getByRole("button", { name: "Submit" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("aria-describedby");
    await userEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  for (const [reason, text] of [
    ["submitting", "Submitting"],
    ["noConnection", "No connection to server"],
    ["updateRequired", "Client update required"],
  ] as const) {
    it(`${reason}: aria-disabled (never disabled) with a visible reason, and no submit`, async () => {
      const onSubmit = renderInForm(reason);
      const button = screen.getByRole("button", { name: "Submit" });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
      expect(button).toHaveAccessibleDescription(text);
      expect(screen.getByText(text)).toBeVisible();
      await userEvent.click(button);
      await userEvent.type(screen.getByLabelText("Field"), "{Enter}");
      expect(onSubmit).not.toHaveBeenCalled();
    });
  }
  it("preview: aria-disabled with the visible reason, but the form still submits so it validates as live (ADR-0011)", async () => {
    const onSubmit = renderInForm("preview");
    const button = screen.getByRole("button", { name: "Submit" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("Preview");
    await userEvent.click(button);
    await userEvent.type(screen.getByLabelText("Field"), "{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
  it("shows the key hint aria-hidden, so the accessible name stays the label", () => {
    render(
      <form>
        <SubmitButton id="qp-submit" reason={null} keyHint="Enter" t={t} />
      </form>,
    );
    const button = screen.getByRole("button", { name: "Submit" });
    expect(button.querySelector(".qm-kbd")).toHaveTextContent("Enter");
    expect(button.querySelector(".qm-kbd")).toHaveAttribute("aria-hidden", "true");
  });
});
