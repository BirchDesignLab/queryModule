import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTranslator, type DraftValue, type LocaleBundle } from "@querymodule/client";
import { SiteConfigSchema, toClientSiteConfig } from "@querymodule/core/config";
import { evaluateForm, type FormState } from "@querymodule/core/rules";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fieldErrors, QueryForm } from "./QueryForm.js";

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
  over: { showErrors?: boolean; values?: Record<string, DraftValue> } = {},
) {
  const onChange = vi.fn();
  const onSubmitAttempt = vi.fn();
  const { container } = render(
    <QueryForm
      formState={state}
      values={over.values ?? {}}
      fieldConfig={new Map()}
      showErrors={over.showErrors ?? false}
      onChange={onChange}
      onSubmitAttempt={onSubmitAttempt}
      t={t}
      idPrefix="qf"
    >
      <button type="submit">Go</button>
    </QueryForm>,
  );
  return { onChange, onSubmitAttempt, container };
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
  });

  // Plan drift: the shipped default site puts plateType in the default section (base), not expanded.
  it("FR-003 VEH with a non-default state reveals a required Plate type in its section", () => {
    setup(form("VEH", { state: "OK" }), { values: { state: "OK" } });
    const base = screen.getByRole("group", { name: "Details" });
    expect(within(base).getByLabelText(/Plate type/)).toHaveAttribute("aria-required", "true");
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
