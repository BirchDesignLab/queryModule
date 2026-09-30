import type { ReactNode, Ref } from "react";
import { FieldMessages, fieldIds, RequiredMark } from "./field-parts.js";

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
  /** Visible text tag rendered after the input, e.g. "default" (spec 6.2). */
  tag?: ReactNode;
  /** Shown inside the label after its text, e.g. an aria-hidden "Shown" tag (not part of the name). */
  adornment?: ReactNode;
  /** Read-back data (a plate, a VIN, a date): set in the monospace face. */
  data?: boolean;
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
  tag,
  adornment,
  data = false,
  ref,
}: TextFieldProps) {
  const ids = fieldIds(id, tag, description, error);
  return (
    <div className="qm-field">
      <label htmlFor={id} className="qm-field__label">
        {label}
        <RequiredMark required={required} requiredText={requiredText} />
        {adornment}
      </label>
      <input
        ref={ref}
        id={id}
        name={id}
        type={type}
        className={data ? "qm-field__input qm-field__input--data" : "qm-field__input"}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-required={required ? "true" : undefined}
        aria-invalid={error === undefined ? undefined : "true"}
        aria-describedby={ids.describedBy}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <FieldMessages ids={ids} tag={tag} description={description} error={error} />
    </div>
  );
}
