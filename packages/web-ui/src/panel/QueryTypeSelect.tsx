import type { JSX } from "react";

export interface QueryTypeSelectProps {
  id: string;
  value: string;
  options: readonly { code: string; label: string }[];
  onChange(code: string): void;
  t(key: string): string;
}

/** The query type picker (spec 6.2): always has a value, so there is no empty option. */
export function QueryTypeSelect({
  id,
  value,
  options,
  onChange,
  t,
}: QueryTypeSelectProps): JSX.Element {
  return (
    <div className="qm-field">
      <label htmlFor={id} className="qm-field__label">
        {t("form.queryType")}
      </label>
      <select
        id={id}
        className="qm-select"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
