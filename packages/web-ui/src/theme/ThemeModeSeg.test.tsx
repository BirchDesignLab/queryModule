import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeModeSeg } from "./ThemeModeSeg.js";

const LABELS: Record<string, string> = {
  "theme.label": "Theme",
  "theme.auto": "Match system",
  "theme.day": "Day",
  "theme.night": "Night",
  "theme.redShift": "Red shift",
};
const t = (key: string) => LABELS[key] ?? key;

describe("UX-002 theme mode segmented control (visual system: controls and states)", () => {
  it("is a labelled group of four aria-pressed buttons, Match system pressed when unset", () => {
    render(<ThemeModeSeg value={null} onChange={() => undefined} t={t} />);
    const group = screen.getByRole("group", { name: "Theme" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Match system",
      "Day",
      "Night",
      "Red shift",
    ]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    expect(group).toHaveClass("qm-seg");
  });
  it("names each button's mode in data-theme-mode, in both the text and the icon form", () => {
    const { rerender } = render(<ThemeModeSeg value={null} onChange={() => undefined} t={t} />);
    const modes = () =>
      within(screen.getByRole("group", { name: "Theme" }))
        .getAllByRole("button")
        .map((b) => b.getAttribute("data-theme-mode"));
    expect(modes()).toEqual(["auto", "day", "night", "redShift"]);
    rerender(<ThemeModeSeg value={null} onChange={() => undefined} t={t} icons />);
    expect(modes()).toEqual(["auto", "day", "night", "redShift"]);
  });
  it("presses only the chosen mode", () => {
    render(<ThemeModeSeg value="night" onChange={() => undefined} t={t} />);
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Match system" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  it("reports the clicked mode", async () => {
    const onChange = vi.fn();
    render(<ThemeModeSeg value="day" onChange={onChange} t={t} />);
    await userEvent.click(screen.getByRole("button", { name: "Red shift" }));
    expect(onChange).toHaveBeenCalledWith("redShift");
  });
  it("icons: each button is named by its label and shows a decorative icon, no text", () => {
    render(<ThemeModeSeg value="night" onChange={() => undefined} t={t} icons />);
    const group = screen.getByRole("group", { name: "Theme" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Match system",
      "Day",
      "Night",
      "Red shift",
    ]);
    for (const b of buttons) {
      expect(b.textContent).toBe("");
      expect(b.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-pressed", "true");
    expect(group).toHaveClass("qm-seg", "qm-seg--icons");
  });
});
