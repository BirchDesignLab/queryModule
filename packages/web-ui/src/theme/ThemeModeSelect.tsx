import {
  isThemeModePreference,
  THEME_PREFERENCES,
  type ThemeModePreference,
} from "@querymodule/client";

export interface ThemeModeSelectProps {
  id: string;
  value: ThemeModePreference | null;
  onChange(value: ThemeModePreference): void;
  t(key: string): string;
}

export function ThemeModeSelect({ id, value, onChange, t }: ThemeModeSelectProps) {
  return (
    <div className="qm-field">
      <label htmlFor={id} className="qm-field__label">
        {t("theme.label")}
      </label>
      <select
        id={id}
        className="qm-select"
        value={value ?? "auto"}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (isThemeModePreference(next)) onChange(next);
        }}
      >
        {THEME_PREFERENCES.map((mode) => (
          <option key={mode} value={mode}>
            {t(`theme.${mode}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
