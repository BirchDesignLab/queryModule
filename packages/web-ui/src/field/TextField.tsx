import type { Ref } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

export interface TextFieldProps {
  id: string;
  /** Already resolved from labelKey by the caller (NFR-001). */
  label: string;
  /** Resolved "required" text for screen readers. */
  requiredText: string;
  required?: boolean;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "decimal";
  value: string;
  onChange(value: string): void;
  error?: string | undefined;
  description?: string | undefined;
  ref?: Ref<HTMLInputElement>;
}

/** Shared field primitive (spec 6.2 semantics table): label, aria-required, aria-invalid, aria-describedby. */
export function TextField({
  id,
  label,
  requiredText,
  required = false,
  type = "text",
  autoComplete,
  inputMode,
  value,
  onChange,
  error,
  description,
  ref,
}: TextFieldProps) {
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
      <input
        ref={ref}
        id={id}
        name={id}
        type={type}
        className="qm-field__input"
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-required={required ? "true" : undefined}
        aria-invalid={error === undefined ? undefined : "true"}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
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
