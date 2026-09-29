import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuickAccessBar } from "./QuickAccessBar.js";

const LABELS: Record<string, string> = {
  VEH: "Vehicle",
  PER: "Person",
  "form.quickAccess": "Quick access",
};
const labelOf = (code: string) => LABELS[code] ?? code;
const t = (key: string) => LABELS[key] ?? key;

describe("FR-007 quick access bar (spec 6.2)", () => {
  it("is a labelled group of toggle buttons; only the current type is pressed", () => {
    render(
      <QuickAccessBar
        codes={["VEH", "PER"]}
        current="PER"
        labelOf={labelOf}
        onSelect={() => undefined}
        t={t}
      />,
    );
    const group = screen.getByRole("group", { name: "Quick access" });
    expect(group).toBeInTheDocument();
    expect(group).toHaveClass("qm-quick-access");
    expect(screen.getByRole("button", { name: "Person" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Vehicle" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  it("reports the chosen code", async () => {
    const onSelect = vi.fn();
    render(
      <QuickAccessBar
        codes={["VEH", "PER"]}
        current="VEH"
        labelOf={labelOf}
        onSelect={onSelect}
        t={t}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Person" }));
    expect(onSelect).toHaveBeenCalledWith("PER");
  });
  it("renders nothing when no codes are configured", () => {
    const { container } = render(
      <QuickAccessBar
        codes={[]}
        current="VEH"
        labelOf={labelOf}
        onSelect={() => undefined}
        t={t}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it("shows the type code in mono without changing the button's accessible name", () => {
    render(
      <QuickAccessBar
        codes={["VEH", "PER"]}
        current="VEH"
        labelOf={labelOf}
        onSelect={() => undefined}
        t={t}
      />,
    );
    const button = screen.getByRole("button", { name: "Vehicle" });
    const code = button.querySelector(".qm-quick-access__code");
    expect(code).toHaveTextContent("VEH");
    expect(code).toHaveAttribute("aria-hidden", "true");
  });
  it("declares aria-keyshortcuts only where a shortcut is bound, with one hint line", () => {
    render(
      <QuickAccessBar
        codes={["VEH", "PER", "PRO"]}
        current="VEH"
        labelOf={labelOf}
        onSelect={() => undefined}
        shortcutOf={(_code, index) => (index < 2 ? `Alt+${index + 1}` : undefined)}
        hint="Alt+1 to Alt+2 pick a type"
        t={t}
      />,
    );
    expect(screen.getByRole("button", { name: "Vehicle" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+1",
    );
    expect(screen.getByRole("button", { name: "Person" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+2",
    );
    expect(screen.getByRole("button", { name: "PRO" })).not.toHaveAttribute("aria-keyshortcuts");
    expect(screen.getByText("Alt+1 to Alt+2 pick a type")).toBeVisible();
  });
  it("declares none and shows no hint when no shortcut function is given (preview)", () => {
    render(
      <QuickAccessBar
        codes={["VEH"]}
        current="VEH"
        labelOf={labelOf}
        onSelect={() => undefined}
        t={t}
      />,
    );
    expect(screen.getByRole("button", { name: "Vehicle" })).not.toHaveAttribute(
      "aria-keyshortcuts",
    );
    expect(document.querySelector(".qm-quick-access__hint")).toBeNull();
  });
});
