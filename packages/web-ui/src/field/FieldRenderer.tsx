import type { DraftValue, Translator } from "@querymodule/client";
import type { FieldState } from "@querymodule/core/rules";
import type { JSX } from "react";
import { CheckboxField } from "./CheckboxField.js";
import { SegField } from "./SegField.js";
import { SelectField } from "./SelectField.js";
import { TextField } from "./TextField.js";

export interface FieldRendererProps {
  /** From evaluateForm; hidden fields are never passed. */
  field: FieldState;
  /** The draft's raw value for this field. */
  userValue: DraftValue;
  /** Resolved message, shown only after a blocked submit. */
  error?: string;
  onChange(key: string, value: DraftValue): void;
  t: Translator["t"];
  idPrefix: string;
  /** Date fields only: shown in the description (spec 6.2 table). A year takes two or four digits. */
  inputFormats?: readonly string[];
  /** Number fields: decimal keypad when "decimal". */
  numberKind?: "integer" | "decimal";
  /** Picklists: "seg" draws a short list as a segmented control (the subtype bar); default is a select. */
  presentation?: "seg";
}

/** Generic renderer: dataType picks the control; no per-query-type code (BR-001). */
export function FieldRenderer({
  field,
  userValue,
  error,
  onChange,
  t,
  idPrefix,
  inputFormats,
  numberKind,
  presentation,
}: FieldRendererProps): JSX.Element {
  const id = `${idPrefix}-${field.key}`;
  const label = t(field.labelKey);
  const requiredText = t("form.required");
  const tag = field.isDefault ? t("form.defaultTag") : undefined;
  // "" is no user value: core canonicalises it to null, so the default still applies (FR-004, FR-005).
  const hasUser = userValue !== null && userValue !== "";
  const shown = hasUser ? userValue : field.isDefault ? field.effectiveValue : null;
  const common = { id, label, requiredText, required: field.required, error, tag };

  if (field.dataType === "boolean") {
    return (
      <CheckboxField
        {...common}
        checked={shown === true}
        onChange={(checked) => onChange(field.key, checked)}
      />
    );
  }
  if (field.dataType === "picklist" && presentation === "seg") {
    return (
      <SegField
        {...common}
        options={(field.options ?? []).map((o) => ({ code: o.code, label: t(o.labelKey) }))}
        value={typeof shown === "string" ? shown : ""}
        onChange={(value) => onChange(field.key, value)}
      />
    );
  }
  if (field.dataType === "picklist") {
    return (
      <SelectField
        {...common}
        options={(field.options ?? []).map((o) => ({ code: o.code, label: t(o.labelKey) }))}
        value={typeof shown === "string" ? shown : ""}
        onChange={(value) => onChange(field.key, value)}
      />
    );
  }
  const inputMode =
    field.dataType === "number" && numberKind === "decimal"
      ? "decimal"
      : field.dataType === "number" || field.dataType === "date" || field.dataType === "year"
        ? "numeric"
        : undefined;
  const description =
    field.dataType === "date" && inputFormats !== undefined && inputFormats.length > 0
      ? t("form.dateFormats", { formats: inputFormats.join(", ") })
      : undefined;
  return (
    <TextField
      {...common}
      type="text"
      inputMode={inputMode}
      description={description}
      value={shown === null ? "" : String(shown)}
      onChange={(value) => onChange(field.key, value)}
    />
  );
}
