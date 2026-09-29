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

describe("FR-003 quick access bar (spec 6.2)", () => {
  it("is a labelled nav of toggle buttons; only the current type is pressed", () => {
    render(
      <QuickAccessBar
        codes={["VEH", "PER"]}
        current="PER"
        labelOf={labelOf}
        onSelect={() => undefined}
        t={t}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Quick access" });
    expect(nav).toBeInTheDocument();
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
});
