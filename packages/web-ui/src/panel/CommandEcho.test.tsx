import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandEcho } from "./CommandEcho.js";

describe("command echo (visual system signature element, spec 4.4)", () => {
  it("shows the command in mono under a name, and an action that edits it", async () => {
    const onEdit = vi.fn();
    render(
      <CommandEcho
        text="VEH.ZZ-1234.TX"
        label="Command"
        actionLabel="Edit as command"
        onEdit={onEdit}
      />,
    );
    expect(screen.getByText("VEH.ZZ-1234.TX").tagName).toBe("CODE");
    expect(screen.getByLabelText("Command")).toHaveTextContent("VEH.ZZ-1234.TX");
    await userEvent.click(screen.getByRole("button", { name: "Edit as command" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
  it("is not a live region", () => {
    render(
      <CommandEcho text="VEH" label="Command" actionLabel="Edit as command" onEdit={() => {}} />,
    );
    expect(document.querySelector("[aria-live],[role=status],[role=alert]")).toBeNull();
  });
  it("renders nothing without a command", () => {
    const { container } = render(
      <CommandEcho text="" label="Command" actionLabel="Edit as command" onEdit={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
