import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TerminalInput } from "./TerminalInput.js";

function Harness(props: {
  errors?: string[];
  unshown?: string | null;
  onSubmit?: () => void;
  initial?: string;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <TerminalInput
      id="term"
      label="Terminal"
      errorsLabel="Problems"
      description="Commands separated by a delimiter"
      value={value}
      onChange={setValue}
      onSubmit={props.onSubmit ?? (() => {})}
      errors={props.errors ?? []}
      unshown={props.unshown ?? null}
    >
      <button type="submit">Go</button>
    </TerminalInput>
  );
}

describe("FR-055 terminal input semantics (spec 6.2)", () => {
  it("has a label, autocomplete off and no spellcheck", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Terminal");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("autocapitalize", "off");
    expect(input.closest("form")).toHaveAttribute("data-terminal");
    expect(input.closest("form")).toHaveAttribute("data-shortcut-context", "terminal");
  });

  it("FR-056 lists errors, links them and marks the input invalid", () => {
    render(<Harness errors={["Bad one", "Bad two"]} />);
    const input = screen.getByLabelText("Terminal");
    const list = screen.getByRole("list", { name: "Problems" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(input.getAttribute("aria-describedby")).toContain(list.id);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("omits the list and aria-invalid with no errors", () => {
    render(<Harness />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByLabelText("Terminal")).not.toHaveAttribute("aria-invalid");
  });

  it("links the unshown note", () => {
    render(<Harness unshown="2 fields not shown" />);
    const note = screen.getByText("2 fields not shown");
    expect(screen.getByLabelText("Terminal").getAttribute("aria-describedby")).toContain(note.id);
  });

  it("Enter submits once and keeps the text and focus", async () => {
    const onSubmit = vi.fn();
    render(<Harness initial="VEH ZZ-1234" onSubmit={onSubmit} errors={["Bad"]} />);
    const input = screen.getByLabelText("Terminal");
    await userEvent.click(input);
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("VEH ZZ-1234");
    expect(input).toHaveFocus();
  });
});
