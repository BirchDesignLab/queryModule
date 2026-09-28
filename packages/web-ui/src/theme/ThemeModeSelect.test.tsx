import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThemeModeSelect } from "./ThemeModeSelect.js";

const LABELS: Record<string, string> = {
  "theme.label": "Theme",
  "theme.auto": "Match system",
  "theme.day": "Day",
  "theme.night": "Night",
  "theme.redShift": "Red shift",
};
const t = (key: string) => LABELS[key] ?? key;

describe("UX-002 theme mode switch (spec 6.2 preferences)", () => {
  it("is a labelled select with the four choices, showing auto when unset", () => {
    render(<ThemeModeSelect id="theme" value={null} onChange={() => undefined} t={t} />);
    const select = screen.getByLabelText("Theme");
    expect(select).toHaveValue("auto");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Match system",
      "Day",
      "Night",
      "Red shift",
    ]);
  });
  it("reports the chosen mode", async () => {
    const onChange = vi.fn();
    render(<ThemeModeSelect id="theme" value="day" onChange={onChange} t={t} />);
    await userEvent.selectOptions(screen.getByLabelText("Theme"), "redShift");
    expect(onChange).toHaveBeenCalledWith("redShift");
  });
});
