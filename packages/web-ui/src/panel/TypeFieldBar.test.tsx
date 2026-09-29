import type { FieldState } from "@querymodule/core/rules";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TypeFieldBar } from "./TypeFieldBar.js";

const t = (key: string) => (key === "form.required" ? "required" : key);

function field(over: Partial<FieldState> = {}): FieldState {
  return {
    key: "propertyType",
    labelKey: "field.propertyType",
    dataType: "picklist",
    role: "type",
    order: 1,
    section: "main",
    sectionLabelKey: "section.main",
    visible: true,
    required: true,
    userValue: null,
    effectiveValue: null,
    isDefault: false,
    options: [{ code: "BOAT", labelKey: "picklist.propertyType.BOAT" }],
    ...over,
  };
}

const base = {
  values: {},
  fieldConfig: new Map(),
  showErrors: false,
  errors: new Map<string, string>(),
  onChange: () => undefined,
  t,
  idPrefix: "qp",
};

describe("type fields bar (spec 4.1 Type fields, ADR-0010)", () => {
  it("renders nothing for no fields", () => {
    const { container } = render(<TypeFieldBar {...base} fields={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no type field is visible", () => {
    const { container } = render(<TypeFieldBar {...base} fields={[field({ visible: false })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one labelled control per visible type field", () => {
    render(
      <TypeFieldBar
        {...base}
        fields={[
          field(),
          field({ key: "other", labelKey: "field.other", dataType: "string", options: undefined }),
        ]}
      />,
    );
    expect(screen.getByLabelText(/field\.propertyType/)).toBeInTheDocument();
    expect(screen.getByLabelText(/field\.other/)).toBeInTheDocument();
  });

  it("marks the control invalid with showErrors and an error", () => {
    render(
      <TypeFieldBar
        {...base}
        showErrors
        errors={new Map([["propertyType", "Property type is required."]])}
        fields={[field()]}
      />,
    );
    const control = screen.getByLabelText(/field\.propertyType/);
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAccessibleDescription("Property type is required.");
  });

  it("shows no error before a blocked submit", () => {
    render(
      <TypeFieldBar
        {...base}
        errors={new Map([["propertyType", "Property type is required."]])}
        fields={[field()]}
      />,
    );
    expect(screen.getByLabelText(/field\.propertyType/)).not.toHaveAttribute("aria-invalid");
  });
});
