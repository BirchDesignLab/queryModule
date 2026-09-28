import type { ReactNode, Ref } from "react";
import { FieldMessages, fieldIds, RequiredMark } from "./field-parts.js";

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
  const ids = fieldIds(id, tag, description, error);
  return (
    <div className="qm-field">
      <label htmlFor={id} className="qm-field__label">
        {label}
        <RequiredMark required={required} requiredText={requiredText} />
      </label>
      <select
        ref={ref}
        id={id}
        name={id}
        className="qm-select"
        value={value}
        aria-required={required ? "true" : undefined}
        aria-invalid={error === undefined ? undefined : "true"}
        aria-describedby={ids.describedBy}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="" />
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldMessages ids={ids} tag={tag} description={description} error={error} />
    </div>
  );
}
