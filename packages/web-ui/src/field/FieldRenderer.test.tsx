import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTranslator } from "@querymodule/client";
import type { FieldState } from "@querymodule/core/rules";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FieldRenderer, type FieldRendererProps } from "./FieldRenderer.js";

const { t } = createTranslator("en", {
  form: { required: "required", defaultTag: "default", dateFormats: "Accepted formats: {formats}" },
  f: { state: "State", tx: "Texas", ok: "Oklahoma", nm: "New Mexico", name: "Name", flag: "Flag" },
});

function field(over: Partial<FieldState>): FieldState {
  return {
    key: "name",
    labelKey: "f.name",
    dataType: "string",
    order: 1,
    section: "s",
    sectionLabelKey: "f.name",
    visible: true,
    required: false,
    userValue: null,
    effectiveValue: null,
    isDefault: false,
    ...over,
  };
}

function setup(over: Partial<FieldState>, props: Partial<FieldRendererProps> = {}) {
  const onChange = vi.fn();
  render(
    <FieldRenderer
      field={field(over)}
      userValue={null}
      onChange={onChange}
      t={t}
      idPrefix="qf"
      {...props}
    />,
  );
  return onChange;
}

const picklist: Partial<FieldState> = {
  key: "state",
  labelKey: "f.state",
  dataType: "picklist",
  options: [
    { code: "TX", labelKey: "f.tx" },
    { code: "OK", labelKey: "f.ok" },
    { code: "NM", labelKey: "f.nm" },
  ],
};

describe("FR-001 picklist renders as a labelled select", () => {
  it("has the empty option plus exactly the configured options", () => {
    setup(picklist);
    const select = screen.getByLabelText("State");
    expect(select.tagName).toBe("SELECT");
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["", "Texas", "Oklahoma", "New Mexico"]);
  });
  it("reports the chosen code through onChange", async () => {
    const onChange = setup(picklist);
    await userEvent.selectOptions(screen.getByLabelText("State"), "OK");
    expect(onChange).toHaveBeenCalledWith("state", "OK");
  });
});

describe("FR-004 default values show the effective value and a tag", () => {
  it("selects the effective value and shows the default tag", () => {
    setup({ ...picklist, isDefault: true, effectiveValue: "TX" });
    expect(screen.getByLabelText("State")).toHaveValue("TX");
    expect(screen.getByText("default")).toBeInTheDocument();
  });
  it("prefers the user value over the default", () => {
    setup({ ...picklist, isDefault: false, effectiveValue: "TX" }, { userValue: "OK" });
    expect(screen.getByLabelText("State")).toHaveValue("OK");
    expect(screen.queryByText("default")).toBeNull();
  });
  it("shows a text default in the input and typing reports a user value", async () => {
    const onChange = setup({ isDefault: true, effectiveValue: "ZZ" });
    const input = screen.getByLabelText("Name");
    expect(input).toHaveValue("ZZ");
    await userEvent.type(input, "Q");
    expect(onChange).toHaveBeenCalledWith("name", "ZZQ");
  });
});

describe("FR-004, FR-005 an empty draft value means no user value", () => {
  it("shows the default again for a cleared text default", () => {
    setup({ isDefault: true, effectiveValue: "ZZ" }, { userValue: "" });
    expect(screen.getByLabelText("Name")).toHaveValue("ZZ");
    expect(screen.getByText("default")).toBeInTheDocument();
  });
  it("shows the default for the empty picklist option on a default", () => {
    setup({ ...picklist, isDefault: true, effectiveValue: "TX" }, { userValue: "" });
    expect(screen.getByLabelText("State")).toHaveValue("TX");
  });
  it("shows blank for an empty value with no default", () => {
    setup({}, { userValue: "" });
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });
});

describe("UX-004 the default tag is announced", () => {
  it("describes a text input, select and checkbox by the tag", () => {
    setup({ isDefault: true, effectiveValue: "ZZ" });
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("default");
  });
  it("describes a select by the tag", () => {
    setup({ ...picklist, isDefault: true, effectiveValue: "TX" });
    expect(screen.getByLabelText("State")).toHaveAccessibleDescription("default");
  });
  it("describes a checkbox by the tag and keeps it out of the name", () => {
    setup({ dataType: "boolean", labelKey: "f.flag", isDefault: true, effectiveValue: true });
    const box = screen.getByRole("checkbox", { name: "Flag" });
    expect(box).toHaveAccessibleDescription("default");
  });
});

describe("UX-004 required and invalid state never rely on colour", () => {
  it("marks a required field with aria-required and hidden text", () => {
    setup({ required: true });
    expect(screen.getByLabelText(/Name/)).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("required")).toBeInTheDocument();
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });
  it("ties the error to the input", () => {
    setup({}, { error: "Name is required." });
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Name is required.");
  });
  it("ties the error to a select", () => {
    setup(picklist, { error: "Pick one." });
    const select = screen.getByLabelText("State");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAccessibleDescription("Pick one.");
  });
});

describe("FR-005 data type semantics", () => {
  it("lists accepted formats for a date field", () => {
    setup({ dataType: "date" }, { inputFormats: ["MM/DD/YYYY", "YYYY-MM-DD"] });
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription(
      "Accepted formats: MM/DD/YYYY, YYYY-MM-DD",
    );
    expect(screen.getByLabelText("Name")).toHaveAttribute("inputmode", "numeric");
  });
  it("uses a numeric keypad for an integer number", () => {
    setup({ dataType: "number" });
    expect(screen.getByLabelText("Name")).toHaveAttribute("inputmode", "numeric");
  });
  it("uses a numeric keypad for a year and shows no date formats", () => {
    setup({ dataType: "year" }, { inputFormats: ["YY", "YYYY", "MM/DD/YYYY"] });
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/Accepted formats/)).toBeNull();
  });
  it("uses a decimal keypad for decimal numbers", () => {
    setup({ dataType: "number" }, { numberKind: "decimal" });
    expect(screen.getByLabelText("Name")).toHaveAttribute("inputmode", "decimal");
  });
  it("renders a boolean as a checkbox and reports toggles", async () => {
    const onChange = setup({ dataType: "boolean", labelKey: "f.flag", key: "flag" });
    const box = screen.getByRole("checkbox", { name: "Flag" });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith("flag", true);
  });
  it("shows an effective boolean default as checked", () => {
    setup({ dataType: "boolean", labelKey: "f.flag", isDefault: true, effectiveValue: true });
    expect(screen.getByRole("checkbox", { name: /Flag/ })).toBeChecked();
  });
});

describe("BR-001 no per-query-type code", () => {
  it("renders from the field state alone", () => {
    setup({ key: "anything", labelKey: "f.name" });
    expect(screen.getByLabelText("Name")).toHaveAttribute("name", "qf-anything");
  });
});

describe("UX-004 a picklist or checkbox in error carries the same border cue as a text input", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8");
  it("styles select and checkbox aria-invalid with the required colour token", () => {
    const block = css.split("}").find((b) => b.includes(".qm-select[aria-invalid"));
    expect(block).toBeDefined();
    expect(block).toContain('.qm-select[aria-invalid="true"]');
    expect(block).toContain('.qm-checkbox input[aria-invalid="true"]');
    expect(block).toContain("border-color: var(--qm-field-required)");
  });
});

describe("read-back data in the monospace face (visual system Direction)", () => {
  it("data marks the text input; without it the input keeps the interface face", () => {
    setup({ dataType: "string" }, { data: true });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveClass("qm-field__input--data");
  });

  it("no data flag, no data class", () => {
    setup({ dataType: "string" });
    expect(screen.getByRole("textbox", { name: "Name" })).not.toHaveClass("qm-field__input--data");
  });
});
