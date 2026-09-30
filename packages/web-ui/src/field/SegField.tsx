import type { ReactNode } from "react";
import { FieldMessages, fieldIds, RequiredMark } from "./field-parts.js";

export interface SegFieldProps {
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
  /** Shown inside the label after its text, e.g. an aria-hidden "Shown" tag (not part of the name). */
  adornment?: ReactNode;
}

/**
 * A short picklist as a segmented control: one radio per option inside a fieldset named by its
 * legend. Radios, not aria-pressed buttons, because it is a single choice that takes part in
 * validation: aria-invalid, aria-required and the first-invalid focus all work on a radio. The
 * radio input is visually hidden; its label draws the segment and the ring (E1).
 */
export function SegField({
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
  adornment,
}: SegFieldProps) {
  const ids = fieldIds(id, tag, description, error);
  return (
    <fieldset className="qm-field qm-field--seg" aria-describedby={ids.describedBy}>
      <legend className="qm-field__label">
        {label}
        <RequiredMark required={required} requiredText={requiredText} />
        {adornment}
      </legend>
      <div className="qm-seg qm-seg--options">
        {options.map((o) => (
          <label key={o.code} className="qm-seg__option">
            <input
              id={`${id}-${o.code}`}
              type="radio"
              name={id}
              value={o.code}
              checked={value === o.code}
              required={required}
              aria-invalid={error === undefined ? undefined : "true"}
              onChange={() => onChange(o.code)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <FieldMessages ids={ids} tag={tag} description={description} error={error} />
    </fieldset>
  );
}
