import type { ReactNode, Ref } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

export interface CheckboxFieldProps {
  id: string;
  /** Already resolved from labelKey by the caller (NFR-001). */
  label: string;
  requiredText: string;
  required?: boolean;
  checked: boolean;
  onChange(checked: boolean): void;
  error?: string | undefined;
  description?: string | undefined;
  tag?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

/** Boolean primitive: a checkbox wrapped by its label. */
export function CheckboxField({
  id,
  label,
  requiredText,
  required = false,
  checked,
  onChange,
  error,
  description,
  tag,
  ref,
}: CheckboxFieldProps) {
  const descriptionId = description === undefined ? undefined : `${id}-description`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [descriptionId, errorId].filter((x) => x !== undefined).join(" ");
  return (
    <div className="qm-field">
      <label htmlFor={id} className="qm-checkbox">
        <input
          ref={ref}
          id={id}
          name={id}
          type="checkbox"
          checked={checked}
          aria-required={required ? "true" : undefined}
          aria-invalid={error === undefined ? undefined : "true"}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="qm-field__label">
          {label}
          {required ? (
            <>
              <span aria-hidden="true" className="qm-field__required-mark">
                {" "}
                *
              </span>
              <VisuallyHidden> {requiredText}</VisuallyHidden>
            </>
          ) : null}
        </span>
        {tag === undefined || tag === null ? null : <span className="qm-field__tag">{tag}</span>}
      </label>
      {description === undefined ? null : (
        <p id={descriptionId} className="qm-field__description">
          {description}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="qm-field__error">
          {error}
        </p>
      )}
    </div>
  );
}
