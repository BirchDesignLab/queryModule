import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTranslator, type DraftValue, type LocaleBundle } from "@querymodule/client";
import { SiteConfigSchema, toClientSiteConfig } from "@querymodule/core/config";
import { evaluateForm, type FormState } from "@querymodule/core/rules";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  blockedErrorCount,
  fieldErrors,
  fieldSpan,
  formLevelErrors,
  QueryForm,
} from "./QueryForm.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): unknown => JSON.parse(readFileSync(join(here, rel), "utf8"));
const config = toClientSiteConfig(
  SiteConfigSchema.parse(read("../../../config/sites/default.json")),
  "0".repeat(64),
);
const flat = read("../../../config/locales/en.json") as Record<string, string>;
const bundle: Record<string, unknown> = {};
for (const [key, text] of Object.entries(flat)) {
  let node = bundle;
  const parts = key.split(".");
  for (const part of parts.slice(0, -1)) {
    node[part] = (node[part] as Record<string, unknown> | undefined) ?? {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1] as string] = text;
}
const { t } = createTranslator("en", bundle as LocaleBundle);

function form(queryType: string, input: Record<string, string | null> = {}): FormState {
  return evaluateForm(config, queryType, input, { now: Date.UTC(2026, 8, 28) });
}

function setup(
  state: FormState,
  over: {
    showErrors?: boolean;
    values?: Record<string, DraftValue>;
    excludeKeys?: ReadonlySet<string>;
    fieldConfig?: ReadonlyMap<string, { maxLength?: number }>;
  } = {},
) {
  const onChange = vi.fn();
  const onSubmitAttempt = vi.fn();
  const { container } = render(
    <QueryForm
      formState={state}
      values={over.values ?? {}}
      fieldConfig={over.fieldConfig ?? new Map()}
      showErrors={over.showErrors ?? false}
      onChange={onChange}
      onSubmitAttempt={onSubmitAttempt}
      t={t}
      idPrefix="qf"
      excludeKeys={over.excludeKeys}
    >
      <button type="submit">Go</button>
    </QueryForm>,
  );
  return { onChange, onSubmitAttempt, container };
}

/** Like setup, but returns a rerender that keeps the same mounted form. */
function renderForm(state: FormState, over: { showErrors?: boolean } = {}) {
  const view = (
    next: FormState,
    o: { showErrors?: boolean; values?: Record<string, DraftValue> },
  ) => (
    <QueryForm
      formState={next}
      values={o.values ?? {}}
      fieldConfig={new Map()}
      showErrors={o.showErrors ?? false}
      onChange={() => undefined}
      onSubmitAttempt={() => undefined}
      t={t}
      idPrefix="qf"
    />
  );
  const r = render(view(state, over));
  return {
    rerender: (
      next: FormState,
      o: { showErrors?: boolean; values?: Record<string, DraftValue> } = {},
    ) => r.rerender(view(next, o)),
  };
}

describe("FR-002 sections render as fieldsets", () => {
  it("VEH with no input shows the base section only, fields in order", () => {
    setup(form("VEH"));
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAccessibleName("Details");
    const labels = within(groups[0] as HTMLElement)
      .getAllByRole("textbox")
      .map((el) => el.getAttribute("id"));
    expect(labels).toEqual(["qf-plate", "qf-year", "qf-vin"]);
    expect(within(groups[0] as HTMLElement).getByLabelText(/State/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "More details" })).toBeNull();
    // Hidden fields are not rendered (spec 4.3, 6.2): plateType is hidden until a non-default state.
    expect(screen.queryByLabelText(/Plate type/)).toBeNull();
    // Every control, picklists included, in the configured field order.
    const expected = form("VEH")
      .fields.filter((f) => f.visible)
      .sort((a, b) => a.order - b.order)
      .map((f) => `qf-${f.key}`);
    const controls = [...(groups[0] as HTMLElement).querySelectorAll("input, select")].map((el) =>
      el.getAttribute("id"),
    );
    expect(controls).toEqual(expected);
    expect(controls).toHaveLength(4);
    expect(controls).toContain("qf-state");
  });

  it("groups by section, sorts by order, and omits a visible section with no visible fields", () => {
    const base = form("VEH", { state: "OK" });
    const moved: FormState = {
      ...base,
      sections: base.sections.map((s) => (s.key === "expanded" ? { ...s, visible: true } : s)),
      fields: [...base.fields]
        .reverse()
        .map((f) => (f.key === "plateType" ? { ...f, section: "expanded" } : f)),
    };
    setup(moved, { values: { state: "OK" } });
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.querySelector("legend")?.textContent)).toEqual([
      "Details",
      "More details",
    ]);
    const ids = (g: HTMLElement) =>
      within(g)
        .getAllByRole("textbox")
        .map((el) => el.getAttribute("id"));
    expect(ids(groups[0] as HTMLElement)).toEqual(["qf-plate", "qf-year", "qf-vin"]);
    expect(within(groups[1] as HTMLElement).getByLabelText(/Plate type/)).toBeInTheDocument();
    expect(within(groups[0] as HTMLElement).queryByLabelText(/Plate type/)).toBeNull();
  });

  it("omits a visible section whose fields are all hidden", () => {
    const base = form("VEH", { state: "OK" });
    const emptied: FormState = {
      ...base,
      sections: base.sections.map((s) => (s.key === "expanded" ? { ...s, visible: true } : s)),
      fields: base.fields.map((f) => (f.section === "expanded" ? { ...f, visible: false } : f)),
    };
    setup(emptied);
    expect(screen.queryByRole("group", { name: "More details" })).toBeNull();
  });

  // Plan drift: the shipped default site puts plateType in the default section (base), not expanded.
  it("FR-003 VEH with a non-default state reveals a required Plate type in its section", () => {
    setup(form("VEH", { state: "OK" }), { values: { state: "OK" } });
    const base = screen.getByRole("group", { name: "Details" });
    expect(within(base).getByLabelText(/Plate type/)).toHaveAttribute("aria-required", "true");
    // #346: the site's custom expanded field (FR-008) shows with Plate type.
    const more = screen.getByRole("group", { name: "More details" });
    expect(within(more).getByLabelText(/Plate color/)).toBeInTheDocument();
  });

  it("FR-008 VEH on the default state shows no More details group", () => {
    setup(form("VEH", { state: "TX" }), { values: { state: "TX" } });
    expect(screen.queryByRole("group", { name: "More details" })).toBeNull();
  });
});

describe("FR-005 blocked submit shows errors", () => {
  it("PER with showErrors marks Last invalid with the required text", () => {
    setup(form("PER"), { showErrors: true });
    const last = screen.getByLabelText(/Last name/);
    expect(last).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Last name is required.")).toBeInTheDocument();
  });

  // Chosen representation for a cleared field: "" (empty string), reported by onChange and treated as empty.
  it("a cleared required field ('') is empty, reports '' and shows required when blocked", async () => {
    const state = form("PER", { last: "" });
    expect(state.missingRequired).toContain("last");
    const { onChange } = setup(state, { showErrors: true, values: { last: "" } });
    expect(screen.getByLabelText(/Last name/)).toHaveValue("");
    expect(screen.getByText("Last name is required.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Last name/), "A");
    expect(onChange).toHaveBeenCalledWith("last", "A");
  });

  it("clearing typed text reports '' through onChange", async () => {
    const { onChange } = setup(form("PER", { last: "A" }), { values: { last: "A" } });
    await userEvent.clear(screen.getByLabelText(/Last name/));
    expect(onChange).toHaveBeenCalledWith("last", "");
  });

  it("shows no errors before a blocked submit", () => {
    setup(form("PER"), { showErrors: false });
    expect(screen.getByLabelText(/Last name/)).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Last name is required.")).toBeNull();
  });
});

describe("FR-006 Enter submits through onSubmitAttempt", () => {
  it("Enter in the Plate input calls onSubmitAttempt once", async () => {
    const { onSubmitAttempt } = setup(form("VEH"));
    await userEvent.type(screen.getByLabelText(/Plate/), "{Enter}");
    expect(onSubmitAttempt).toHaveBeenCalledTimes(1);
  });

  it("reports typed text through onChange", async () => {
    const { onChange } = setup(form("VEH"));
    await userEvent.type(screen.getByLabelText(/Plate/), "A");
    expect(onChange).toHaveBeenCalledWith("plate", "A");
  });
});

describe("UX-004 fieldErrors", () => {
  it("prefers validation.required for a missing field", () => {
    const s = form("PER");
    const withOther: FormState = {
      ...s,
      errors: [{ key: "validation.tooShort", params: { field: "last", min: 2 } }, ...s.errors],
    };
    expect(fieldErrors(withOther).get("last")?.key).toBe("validation.required");
  });

  it("otherwise keeps the first error for that field", () => {
    const s = form("PER", { first: "A" });
    const state: FormState = {
      ...s,
      missingRequired: [],
      errors: [
        { key: "validation.tooShort", params: { field: "first", min: 2 } },
        { key: "validation.invalidCharacter", params: { field: "first" } },
        { key: "validation.modeMismatch" },
      ],
    };
    const errors = fieldErrors(state);
    expect(errors.get("first")?.key).toBe("validation.tooShort");
    expect(errors.size).toBe(1);
  });
});

describe("FR-005 errors that name no rendered field are never dropped", () => {
  const modeMismatch = { key: "validation.modeMismatch" };
  const MODE_TEXT = "The form changed while submitting. Check it and submit again.";
  const withErrors = (s: FormState, errors: FormState["errors"]): FormState => ({
    ...s,
    missingRequired: [],
    errors,
  });

  it("shows a modeMismatch error (no params.field) after a blocked submit", () => {
    setup(withErrors(form("PER"), [modeMismatch]), { showErrors: true });
    expect(screen.getByText(MODE_TEXT)).toBeInTheDocument();
  });

  it("shows it only when showErrors is true, and without role alert", () => {
    const state = withErrors(form("PER"), [modeMismatch]);
    const { container } = setup(state, { showErrors: false });
    expect(screen.queryByText(MODE_TEXT)).toBeNull();
    expect(container.querySelector(".qm-form-errors")).toBeNull();
    cleanup();
    setup(state, { showErrors: true });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error naming a field the form did not render, labelled from labelKey", () => {
    const base = form("VEH");
    const hidden: FormState = {
      ...base,
      missingRequired: [],
      errors: [{ key: "validation.tooShort", params: { field: "plateType", min: 9 } }],
      fields: base.fields.map((f) => (f.key === "plateType" ? { ...f, visible: false } : f)),
    };
    setup(hidden, { showErrors: true });
    expect(screen.getByText("Plate type needs at least 9 characters.")).toBeInTheDocument();
  });

  it("shows an error naming an unknown field through t with its params", () => {
    setup(
      withErrors(form("PER"), [{ key: "validation.unknownField", params: { field: "ghost" } }]),
      { showErrors: true },
    );
    expect(
      screen.getByText("The field ghost does not exist for this query type."),
    ).toBeInTheDocument();
  });

  it("keeps a rendered field error on the field, not in the form list", () => {
    const { container } = setup(form("PER"), { showErrors: true });
    expect(screen.getAllByText("Last name is required.")).toHaveLength(1);
    expect(container.querySelector(".qm-form-errors")).toBeNull();
  });

  it("formLevelErrors and blockedErrorCount count them with the field errors", () => {
    const per = form("PER");
    const state = withErrors(per, [modeMismatch]);
    expect(formLevelErrors(state)).toEqual([modeMismatch]);
    expect(blockedErrorCount(state)).toBe(1);
    expect(blockedErrorCount(per)).toBe(per.missingRequired.length);
    expect(blockedErrorCount({ ...per, errors: [...per.errors, modeMismatch] })).toBe(
      per.missingRequired.length + 1,
    );
  });
});

describe("ADR-0010 excludeKeys", () => {
  it("does not render excluded fields, keeps the others and drops an emptied section", () => {
    const state = form("PRO");
    const visible = state.fields.filter((f) => f.visible);
    setup(state, { excludeKeys: new Set(["propertyType"]) });
    expect(screen.queryByLabelText(/Property type/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Serial/)).toBeInTheDocument();
    cleanup();
    const all = setup(state, { excludeKeys: new Set(visible.map((f) => f.key)) });
    expect(all.container.querySelectorAll("fieldset")).toHaveLength(0);
  });
});

describe("design B2 form grid and the More details disclosure", () => {
  it("fieldSpan: width from data type and maxLength, no per-type code", () => {
    expect(fieldSpan("year", undefined)).toBe(2);
    expect(fieldSpan("date", undefined)).toBe(3);
    expect(fieldSpan("boolean", undefined)).toBe(6);
    expect(fieldSpan("picklist", undefined)).toBe(4);
    expect(fieldSpan("string", 7)).toBe(3);
    expect(fieldSpan("string", 17)).toBe(6);
    expect(fieldSpan("string", 50)).toBe(8);
    expect(fieldSpan("string", 200)).toBe(12);
    expect(fieldSpan("string", undefined)).toBe(12);
  });

  it("renders fields as grid cells with a span class from fieldConfig maxLength", () => {
    const { container } = setup(form("VEH"), {
      fieldConfig: new Map([["vin", { maxLength: 17 }]]),
    });
    expect(container.querySelector(".qm-form-grid")).not.toBeNull();
    const vin = screen.getByLabelText("VIN").closest(".qm-form-cell");
    expect(vin).toHaveClass("qm-span-6");
    expect(screen.getByLabelText("Year").closest(".qm-form-cell")).toHaveClass("qm-span-2");
  });

  it("the first section is a plain group; a later one is a disclosure with the fields in a region", () => {
    // State OK shows Plate type (base) and Plate color (More details).
    setup(form("VEH", { state: "OK" }));
    const more = screen.getByRole("group", { name: "More details" });
    const toggle = within(more).getByRole("button", { name: "More details" });
    expect(toggle).toHaveAttribute("aria-expanded");
    expect(screen.getByRole("group", { name: "Details" }).querySelector("button")).toBeNull();
  });

  it("starts closed with nothing required or entered; the toggle opens and closes it, and the state survives a re-render", async () => {
    const state = form("VEH", { state: "OK" });
    const { rerender } = renderForm(state);
    const toggle = screen.getByRole("button", { name: "More details" });
    const region = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    ) as HTMLElement;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(region).toHaveAttribute("hidden");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(region).not.toHaveAttribute("hidden");
    rerender(state, { values: { plate: "ZZ" } });
    expect(screen.getByRole("button", { name: "More details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "More details" }));
    expect(screen.getByRole("button", { name: "More details" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("a field revealed by a rule opens its closed disclosure, so it is never hidden", () => {
    const { rerender } = renderForm(form("VEH"));
    expect(screen.queryByRole("button", { name: "More details" })).toBeNull();
    rerender(form("VEH", { state: "OK" }));
    const toggle = screen.getByRole("button", { name: "More details" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/Plate color/)).toBeVisible();
  });

  it("a blocked submit opens a disclosure that holds an error", () => {
    // Property: the agency field is in More details; force an error by a required field there is
    // not available in the default site, so use the general rule with an errored key.
    const state = { ...form("VEH", { state: "OK" }), missingRequired: ["plateColor"] };
    renderForm(state, { showErrors: true });
    expect(screen.getByRole("button", { name: "More details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("a section forced open by an error stays open once the error is fixed, and a click on its toggle while forced does not store a close", async () => {
    const state = form("VEH", { state: "OK" });
    const errored = { ...state, missingRequired: ["plateColor"] };
    const { rerender } = renderForm(state);
    // The user closes it (it starts closed), then a blocked submit forces it open.
    const toggle = () => screen.getByRole("button", { name: "More details" });
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    rerender(errored, { showErrors: true });
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    // A click while forced open is a no-op.
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    // The error is fixed (showErrors stays on): the section does not collapse under the user.
    rerender(state, { showErrors: true });
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    // Once nothing forces it, the user can close it.
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });
});
