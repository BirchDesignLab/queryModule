import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextField } from "./field/TextField.js";
import { SourceLine } from "./panel/SourceLine.js";
import { ViewToggle } from "./results/ViewToggle.js";
import { TerminalInput } from "./terminal/TerminalInput.js";
import { ThemeModeSeg } from "./theme/ThemeModeSeg.js";

// BW3b (#835 "Visible" list, mockup v6/v7): the shared parts the admin and query screens draw.

describe("TextField describedBy (#835: the audit window hint sits beside To)", () => {
  it("adds an outside hint after its own description and before its error", () => {
    render(
      <>
        <p id="win">Times are local.</p>
        <TextField
          id="to"
          label="To"
          requiredText=""
          value=""
          onChange={() => undefined}
          describedBy="win"
          error="Enter the end."
        />
      </>,
    );
    const input = screen.getByLabelText("To");
    expect(input).toHaveAttribute("aria-describedby", "win to-error");
    expect(input).toHaveAccessibleDescription("Times are local. Enter the end.");
  });
});

describe("SourceLine icons and the source name (#835, mockup v6 .src-line)", () => {
  it("draws a line icon for each tone, hidden from assistive technology", () => {
    for (const tone of ["pending", "ok", "problem", "notRun", "unknown"] as const) {
      const { container, unmount } = render(<SourceLine tone={tone} text="State source: x" />);
      const icon = container.querySelector(".qm-source__icon svg");
      expect(icon, tone).not.toBeNull();
      expect(container.querySelector(".qm-source__icon")).toHaveAttribute("aria-hidden", "true");
      unmount();
    }
  });

  it("a timed-out line shows the clock icon when asked", () => {
    const { container } = render(
      <SourceLine tone="problem" icon="clock" text="National source: timed out" />,
    );
    expect(container.querySelector('.qm-source__icon svg[data-icon="clock"]')).not.toBeNull();
  });

  it("sets the source name in bold where the text leads with it; the words stay one line", () => {
    const { container } = render(
      <SourceLine tone="notRun" source="National source" text="National source: not run" />,
    );
    expect(container.querySelector(".qm-source__name")).toHaveTextContent("National source:");
    expect(container.firstElementChild).toHaveTextContent("National source: not run");
  });

  it("keeps the text plain when it does not lead with the name (another word order)", () => {
    const { container } = render(<SourceLine tone="ok" source="Fuente" text="Respondió: Fuente" />);
    expect(container.querySelector(".qm-source__name")).toBeNull();
    expect(screen.getByText("Respondió: Fuente")).toBeInTheDocument();
  });
});

describe("ViewToggle chevron (#835, mockup v6 .rc-tog)", () => {
  it("leads with a decorative chevron; the name is unchanged", () => {
    render(
      <ViewToggle
        expanded={false}
        controlsId="d"
        label="Show detail"
        countText="2 more items"
        onToggle={() => undefined}
      />,
    );
    const button = screen.getByRole("button", { name: "Show detail 2 more items" });
    const icon = button.querySelector('svg[data-icon="chevron"]');
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(button.firstElementChild).toBe(icon);
  });
});

describe("TerminalInput prompt and caption (#835, mockup v6 .term-input)", () => {
  it("shows a decorative > prompt and the label as a caption when asked", () => {
    const { container } = render(
      <TerminalInput
        id="term"
        label="Command"
        description="Hint"
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        errors={[]}
        unshown={null}
        errorsLabel="Problems"
        prompt
      />,
    );
    expect(screen.getByLabelText("Command")).toBeInTheDocument();
    expect(container.querySelector(".qm-field__label")).toHaveClass("qm-caption");
    const chip = container.querySelector(".qm-terminal__prompt");
    expect(chip).toHaveAttribute("aria-hidden", "true");
    expect(chip).toHaveTextContent(">");
  });

  it("has neither without the prop", () => {
    const { container } = render(
      <TerminalInput
        id="term"
        label="Command"
        description="Hint"
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        errors={[]}
        unshown={null}
        errorsLabel="Problems"
      />,
    );
    expect(container.querySelector(".qm-terminal__prompt")).toBeNull();
    expect(container.querySelector(".qm-field__label")).not.toHaveClass("qm-caption");
  });
});

describe("ThemeModeSeg caption (#835: the account menu's THEME caption)", () => {
  const t = (key: string) => ({ "theme.label": "Theme" })[key] ?? key;
  it("shows the group's name as a caption when asked; the group keeps its name", () => {
    render(<ThemeModeSeg value={null} onChange={() => undefined} t={t} caption />);
    const group = screen.getByRole("group", { name: "Theme" });
    const legend = group.querySelector("legend");
    expect(legend).toHaveClass("qm-caption");
    expect(legend).toBeVisible();
    expect(within(group).getAllByRole("button")).toHaveLength(4);
  });
});
