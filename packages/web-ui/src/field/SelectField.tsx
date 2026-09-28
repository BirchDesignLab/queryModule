import type { ReactNode, Ref } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

export interface SelectFieldProps {
  id: string;
  /** Already resolved from labelKey by the caller (NFR-001). */
  label: string;
  requiredText: string;
  required?: boolean;
  options: readonly { code: string; label: string }[];
  value: string;
  onChange(value: string): void;
  error?: string | undefined;
  description?: string | undefined;
  tag?: ReactNode;
  ref?: Ref<HTMLSelectElement>;
}

/** Picklist primitive: a first empty option, then the configured options. */
export function SelectField({
  id,
  label,
  requiredText,
  required = false,
  options,
  value,
  onChange,
  error,
  description,
  tag,
  ref,
}: SelectFieldProps) {
  const descriptionId = description === undefined ? undefined : `${id}-description`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [descriptionId, errorId].filter((x) => x !== undefined).join(" ");
  return (
    <div className="qm-field">
      <label htmlFor={id} className="qm-field__label">
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
      </label>
      <select
        ref={ref}
        id={id}
        name={id}
        className="qm-select"
        value={value}
        aria-required={required ? "true" : undefined}
        aria-invalid={error === undefined ? undefined : "true"}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="" />
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
      {tag === undefined || tag === null ? null : <span className="qm-field__tag">{tag}</span>}
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
