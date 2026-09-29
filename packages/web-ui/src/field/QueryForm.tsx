import type { DraftValue, Translator } from "@querymodule/client";
import type { ValidationError } from "@querymodule/core/contracts";
import type { FormState } from "@querymodule/core/rules";
import {
  type FormEvent,
  type JSX,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FieldRenderer } from "./FieldRenderer.js";

export interface QueryFormProps {
  formState: FormState;
  values: Readonly<Record<string, DraftValue>>;
  fieldConfig: ReadonlyMap<
    string,
    { inputFormats?: readonly string[]; numberKind?: "integer" | "decimal"; maxLength?: number }
  >;
  /** True after a blocked submit. */
  showErrors: boolean;
  onChange(key: string, value: DraftValue): void;
  /** The form's native submit: Enter in a field (FR-006) or the Submit button. */
  onSubmitAttempt(): void;
  t: Translator["t"];
  idPrefix: string;
  /** Fields rendered elsewhere (the type bar, ADR-0010): not repeated here; an emptied section is not rendered. */
  excludeKeys?: ReadonlySet<string>;
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
function renderedSections(s: FormState, excludeKeys?: ReadonlySet<string>) {
  return s.sections
    .filter((section) => section.visible)
    .map((section) => ({
      section,
      fields: s.fields
        .filter((f) => f.visible && f.section === section.key && !excludeKeys?.has(f.key))
        .sort((a, b) => a.order - b.order),
    }))
    .filter(({ fields }) => fields.length > 0);
}

/** Resolved error message per field key, with the field label; the same text QueryForm shows. */
export function fieldErrorMessages(s: FormState, t: Translator["t"]): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, error] of fieldErrors(s)) {
    const field = s.fields.find((f) => f.key === key);
    out.set(
      key,
      t(
        error.key,
        field === undefined ? error.params : { ...error.params, label: t(field.labelKey) },
      ),
    );
  }
  return out;
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

/**
 * Grid columns (of 12) a field takes, from its type and maxLength alone (BR-001: no per-query-type
 * UI code): short codes narrow, longer text wider, unbounded text full width.
 */
export function fieldSpan(dataType: string, maxLength: number | undefined): number {
  switch (dataType) {
    case "year":
      return 2;
    case "date":
    case "number":
      return 3;
    case "boolean":
      return 6;
    case "picklist":
      return 4;
    default:
      if (maxLength === undefined) return 12;
      if (maxLength <= 8) return 3;
      if (maxLength <= 20) return 6;
      return maxLength <= 60 ? 8 : 12;
  }
}

/**
 * Sections after the first are disclosures: a button in the legend, the fields in a region that is
 * hidden while closed (still in the DOM, so values and rules are untouched). Open state is kept
 * here, so it survives re-renders. A section starts open when it holds a required field or a value
 * the user already entered, opens when a field appears in it (a rule revealed one) and while a
 * blocked submit shows an error in it; the user's own toggle wins otherwise.
 */
function useDisclosures(
  sections: ReturnType<typeof renderedSections>,
  showErrors: boolean,
  errored: ReadonlySet<string>,
) {
  const [explicit, setExplicit] = useState<Readonly<Record<string, boolean>>>({});
  const seen = useRef<Map<string, number> | null>(null);
  const counts = new Map(sections.map(({ section, fields }) => [section.key, fields.length]));
  // A new visible field in a section (after the first render) opens it, once, so a revealed field
  // is never hidden inside a closed disclosure. Layout effect: it lands in the same commit.
  const hasError = ({ fields }: (typeof sections)[number]): boolean =>
    showErrors && fields.some((f) => errored.has(f.key));
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = counts;
    // A section that holds an error is opened for good: fixing the error must not collapse it
    // under the user's cursor (focus is never lost, spec 6.4).
    const forced = sections.filter(hasError).map(({ section }) => section.key);
    const grown =
      before === null
        ? []
        : [...counts].filter(([key, n]) => n > (before.get(key) ?? 0)).map(([key]) => key);
    const open = [...new Set([...grown, ...forced])].filter((key) => explicit[key] !== true);
    if (open.length > 0)
      setExplicit((prev) => ({ ...prev, ...Object.fromEntries(open.map((key) => [key, true])) }));
  });
  const isOpen = (entry: (typeof sections)[number]): boolean => {
    const { section, fields } = entry;
    if (hasError(entry)) return true;
    const chosen = explicit[section.key];
    if (chosen !== undefined) return chosen;
    return fields.some((f) => f.required || f.userValue !== null);
  };
  // While an error holds a section open, a close is not stored (the click does nothing).
  const toggle = (entry: (typeof sections)[number], next: boolean): void => {
    if (!next && hasError(entry)) return;
    setExplicit((prev) => ({ ...prev, [entry.section.key]: next }));
  };
  return { isOpen, toggle };
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
  excludeKeys,
  children,
}: QueryFormProps): JSX.Element {
  const errors = showErrors ? fieldErrors(formState) : new Map<string, ValidationError>();
  const sections = renderedSections(formState, excludeKeys);
  const disclosures = useDisclosures(sections, showErrors, new Set(errors.keys()));
  const disclosureId = useId();
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
      {sections.map((entry, index) => {
        const { section, fields } = entry;
        const open = index === 0 || disclosures.isOpen(entry);
        const regionId = `${disclosureId}-${section.key}`;
        return (
          <fieldset
            key={section.key}
            className={
              index === 0
                ? "qm-query-form__section"
                : "qm-query-form__section qm-query-form__section--disclosure"
            }
          >
            <legend>
              {index === 0 ? (
                t(section.labelKey)
              ) : (
                <button
                  type="button"
                  className="qm-disclosure-toggle"
                  aria-expanded={open}
                  aria-controls={regionId}
                  onClick={() => disclosures.toggle(entry, !open)}
                >
                  {t(section.labelKey)}
                </button>
              )}
            </legend>
            <div id={regionId} className="qm-form-grid" hidden={!open}>
              {fields.map((field) => {
                const error = errors.get(field.key);
                const cfg = fieldConfig.get(field.key);
                return (
                  <div
                    key={field.key}
                    className={`qm-form-cell qm-span-${fieldSpan(field.dataType, cfg?.maxLength)}`}
                  >
                    <FieldRenderer
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
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
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
