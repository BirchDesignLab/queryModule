import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SourceCheckboxes } from "./SourceCheckboxes.js";

const LABELS: Record<string, string> = {
  "form.sources": "Sources",
  stateSource: "State system",
  nationalSource: "National system",
};
const t = (key: string) => LABELS[key] ?? key;
const labelOf = (id: string) => LABELS[id] ?? id;
const SOURCES = [
  { sourceId: "stateSource", selectedByDefault: true, plateOnly: false },
  { sourceId: "nationalSource", selectedByDefault: true, plateOnly: false },
];

function setup(checked: readonly string[], onChange = vi.fn()) {
  render(
    <SourceCheckboxes
      sources={SOURCES}
      checked={checked}
      labelOf={labelOf}
      onChange={onChange}
      idPrefix="qp"
      t={t}
    />,
  );
  return onChange;
}

describe("source checkboxes (spec 6.2)", () => {
  it("is a fieldset with a Sources legend and one checkbox per eligible source", () => {
    setup(["stateSource"]);
    const group = screen.getByRole("group", { name: "Sources" });
    expect(group.tagName).toBe("FIELDSET");
    expect(screen.getByRole("checkbox", { name: "State system" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "National system" })).not.toBeChecked();
  });
  it("reports the next checked list, in source order, when one is toggled", async () => {
    const onChange = setup(["nationalSource"]);
    await userEvent.click(screen.getByRole("checkbox", { name: "State system" }));
    expect(onChange).toHaveBeenLastCalledWith(["stateSource", "nationalSource"]);
    await userEvent.click(screen.getByRole("checkbox", { name: "National system" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
  it("renders no group when no source is eligible", () => {
    render(
      <SourceCheckboxes
        sources={[]}
        checked={[]}
        labelOf={labelOf}
        onChange={vi.fn()}
        idPrefix="qp"
        t={t}
      />,
    );
    expect(screen.queryByRole("group")).toBeNull();
  });
  it("draws each source as a chip with its timeout in mono, outside the accessible name", () => {
    render(
      <SourceCheckboxes
        sources={SOURCES}
        checked={["stateSource"]}
        labelOf={labelOf}
        timeoutOf={(id) => (id === "stateSource" ? "10 s" : undefined)}
        onChange={() => undefined}
        idPrefix="qp"
        t={t}
      />,
    );
    const box = screen.getByRole("checkbox", { name: "State system" });
    const chip = box.closest(".qm-chip");
    expect(chip).not.toBeNull();
    const meta = chip?.querySelector(".qm-chip__meta");
    expect(meta).toHaveTextContent("10 s");
    expect(meta).toHaveAttribute("aria-hidden", "true");
    // No timeout, no meta.
    expect(
      screen
        .getByRole("checkbox", { name: "National system" })
        .closest(".qm-chip")
        ?.querySelector(".qm-chip__meta"),
    ).toBeNull();
  });
  it("a click on the label text toggles it and the checkbox keeps a stable id", async () => {
    const onChange = setup(["stateSource"]);
    await userEvent.click(screen.getByText("National system"));
    expect(onChange).toHaveBeenCalledWith(["stateSource", "nationalSource"]);
    expect(screen.getByRole("checkbox", { name: "State system" })).toHaveAttribute(
      "id",
      "qp-source-stateSource",
    );
  });
});
