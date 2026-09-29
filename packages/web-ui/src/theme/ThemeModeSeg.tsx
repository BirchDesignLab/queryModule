import { THEME_PREFERENCES, type ThemeModePreference } from "@querymodule/client";
import { VisuallyHidden } from "../visually-hidden.js";

export interface ThemeModeSegProps {
  value: ThemeModePreference | null;
  onChange(value: ThemeModePreference): void;
  t(key: string): string;
}

/** The theme choice as a segmented control: aria-pressed buttons in a sunken track, one pressed. */
export function ThemeModeSeg({ value, onChange, t }: ThemeModeSegProps) {
  const current = value ?? "auto";
  return (
    <fieldset className="qm-seg">
      <legend>
        <VisuallyHidden>{t("theme.label")}</VisuallyHidden>
      </legend>
      {THEME_PREFERENCES.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={mode === current}
          onClick={() => onChange(mode)}
        >
          {t(`theme.${mode}`)}
        </button>
      ))}
    </fieldset>
  );
}
