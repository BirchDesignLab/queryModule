import type { JSX } from "react";

export interface QueryTypeSelectProps {
  id: string;
  /** Label key; "form.otherQueryTypes" when quick-access buttons pick the other types (ADR-0010). */
  labelKey?: "form.queryType" | "form.otherQueryTypes";
  /** Prepends an empty option meaning "none of these". */
  emptyOption?: boolean;
  value: string;
  options: readonly { code: string; label: string }[];
  onChange(code: string): void;
  t(key: string): string;
}

/** The query type picker (spec 6.2, ADR-0010): options are already filtered by the caller. */
export function QueryTypeSelect({
  id,
  labelKey = "form.queryType",
  emptyOption = false,
  value,
  options,
  onChange,
  t,
}: QueryTypeSelectProps): JSX.Element {
  return (
    <div className="qm-field">
      <label htmlFor={id} className="qm-field__label">
        {t(labelKey)}
      </label>
      <select
        id={id}
        className="qm-select"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {emptyOption ? <option value="" /> : null}
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
