import type { ReactNode, Ref } from "react";
import { FieldMessages, fieldIds, RequiredMark } from "./field-parts.js";

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
  /** Shown inside the label after its text, e.g. an aria-hidden "Shown" tag (not part of the name). */
  adornment?: ReactNode;
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
  adornment,
  ref,
}: CheckboxFieldProps) {
  const ids = fieldIds(id, tag, description, error);
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
          aria-describedby={ids.describedBy}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="qm-field__label">
          {label}
          <RequiredMark required={required} requiredText={requiredText} />
          {adornment}
        </span>
      </label>
      <FieldMessages ids={ids} tag={tag} description={description} error={error} />
    </div>
  );
}
