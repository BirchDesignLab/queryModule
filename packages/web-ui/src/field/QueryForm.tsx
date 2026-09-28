import type { DraftValue, Translator } from "@querymodule/client";
import type { ValidationError } from "@querymodule/core/contracts";
import type { FormState } from "@querymodule/core/rules";
import type { FormEvent, JSX, ReactNode } from "react";
import { FieldRenderer } from "./FieldRenderer.js";

export interface QueryFormProps {
  formState: FormState;
  values: Readonly<Record<string, DraftValue>>;
  fieldConfig: ReadonlyMap<
    string,
    { inputFormats?: readonly string[]; numberKind?: "integer" | "decimal" }
  >;
  /** True after a blocked submit. */
  showErrors: boolean;
  onChange(key: string, value: DraftValue): void;
  /** The form's native submit: Enter in a field (FR-006) or the Submit button. */
  onSubmitAttempt(): void;
  t: Translator["t"];
  idPrefix: string;
  /** Source checkboxes and the submit button. */
  children?: ReactNode;
}

/** Errors per field, first one wins: missingRequired first, then errors by params.field (spec 6.2 blocked submit). */
export function fieldErrors(s: FormState): Map<string, ValidationError> {
  const out = new Map<string, ValidationError>();
  for (const key of s.missingRequired) {
    out.set(key, { key: "validation.required", params: { field: key } });
  }
  for (const error of s.errors) {
    const field = error.params?.field;
    if (typeof field === "string" && !out.has(field)) out.set(field, error);
  }
  return out;
}

/** Renders only from FormState (BR-001): visible sections as fieldsets, visible fields in order (spec 6.2). */
export function QueryForm({
  formState,
  values,
  fieldConfig,
  showErrors,
  onChange,
  onSubmitAttempt,
  t,
  idPrefix,
  children,
}: QueryFormProps): JSX.Element {
  const errors = showErrors ? fieldErrors(formState) : new Map<string, ValidationError>();
  const sections = formState.sections
    .filter((section) => section.visible)
    .map((section) => ({
      section,
      fields: formState.fields
        .filter((f) => f.visible && f.section === section.key)
        .sort((a, b) => a.order - b.order),
    }))
    .filter(({ fields }) => fields.length > 0);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmitAttempt();
  }

  return (
    <form noValidate className="qm-query-form" onSubmit={onSubmit}>
      {sections.map(({ section, fields }) => (
        <fieldset key={section.key} className="qm-query-form__section">
          <legend>{t(section.labelKey)}</legend>
          {fields.map((field) => {
            const error = errors.get(field.key);
            const cfg = fieldConfig.get(field.key);
            return (
              <FieldRenderer
                key={field.key}
                field={field}
                userValue={values[field.key] ?? null}
                error={
                  error === undefined
                    ? undefined
                    : t(error.key, { ...error.params, label: t(field.labelKey) })
                }
                onChange={onChange}
                t={t}
                idPrefix={idPrefix}
                inputFormats={cfg?.inputFormats}
                numberKind={cfg?.numberKind}
              />
            );
          })}
        </fieldset>
      ))}
      {children}
    </form>
  );
}
