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

/** Visible fields in visible sections with at least one visible field: the ones QueryForm renders. */
function renderedSections(s: FormState) {
  return s.sections
    .filter((section) => section.visible)
    .map((section) => ({
      section,
      fields: s.fields
        .filter((f) => f.visible && f.section === section.key)
        .sort((a, b) => a.order - b.order),
    }))
    .filter(({ fields }) => fields.length > 0);
}

/**
 * Errors no rendered field can show: no params.field (modeMismatch), or a field the form did not
 * render (hidden, unknown, or in a section that is not shown). Never dropped (spec 6.2 blocked submit).
 */
export function formLevelErrors(s: FormState): ValidationError[] {
  const rendered = new Set(renderedSections(s).flatMap(({ fields }) => fields.map((f) => f.key)));
  const named = (error: ValidationError): string | null => {
    const field = error.params?.field;
    return typeof field === "string" ? field : null;
  };
  const out: ValidationError[] = [];
  const seen = new Set<string>();
  const add = (error: ValidationError): void => {
    const id = `${error.key}|${named(error) ?? ""}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(error);
  };
  for (const key of s.missingRequired) {
    if (!rendered.has(key)) add({ key: "validation.required", params: { field: key } });
  }
  for (const error of s.errors) {
    const field = named(error);
    if (field === null || !rendered.has(field)) add(error);
  }
  return out;
}

/** What a blocked submit announces: one per erroring rendered field, plus each form-level error. */
export function blockedErrorCount(s: FormState): number {
  const rendered = new Set(renderedSections(s).flatMap(({ fields }) => fields.map((f) => f.key)));
  const perField = [...fieldErrors(s).keys()].filter((key) => rendered.has(key)).length;
  return perField + formLevelErrors(s).length;
}

/** The text of one form-level error, with the field label when it names a known field. */
export function formLevelMessages(s: FormState, t: Translator["t"]): string[] {
  return formLevelErrors(s).map((error) => {
    const field = s.fields.find((f) => f.key === error.params?.field);
    return t(
      error.key,
      field === undefined ? error.params : { ...error.params, label: t(field.labelKey) },
    );
  });
}

/** Element id of the form-level error list, for aria-describedby on the submit button. */
export function formErrorsId(idPrefix: string): string {
  return `${idPrefix}-form-errors`;
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
  const sections = renderedSections(formState);
  const formErrors = showErrors ? formLevelErrors(formState) : [];
  const labelOf = (error: ValidationError): string | undefined => {
    const field = formState.fields.find((f) => f.key === error.params?.field);
    return field === undefined ? undefined : t(field.labelKey);
  };

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
      {formErrors.length === 0 ? null : (
        <ul id={formErrorsId(idPrefix)} className="qm-form-errors">
          {formErrors.map((error) => {
            const label = labelOf(error);
            return (
              <li
                key={`${error.key}|${String(error.params?.field ?? "")}`}
                className="qm-form-error"
              >
                {t(error.key, label === undefined ? error.params : { ...error.params, label })}
              </li>
            );
          })}
        </ul>
      )}
      {children}
    </form>
  );
}
