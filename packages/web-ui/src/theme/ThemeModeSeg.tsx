import { THEME_PREFERENCES, type ThemeModePreference } from "@querymodule/client";
import type { JSX } from "react";
import { VisuallyHidden } from "../visually-hidden.js";

export interface ThemeModeSegProps {
  value: ThemeModePreference | null;
  onChange(value: ThemeModePreference): void;
  t(key: string): string;
  /** Icon-only buttons named by aria-label (the officer's bar); text buttons otherwise. */
  icons?: boolean;
}

/** One 24 px line icon per mode, drawn with currentColor so every theme and the focus ring apply. */
const ICON_PATHS: Readonly<Record<ThemeModePreference, JSX.Element>> = {
  auto: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v16" />
    </>
  ),
  day: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" />
    </>
  ),
  night: <path d="M20 14A8 8 0 1 1 10 4a7 7 0 0 0 10 10z" />,
  redShift: (
    <>
      <path d="M20 14A8 8 0 1 1 10 4a7 7 0 0 0 10 10z" />
      <path d="M3 21h18" />
    </>
  ),
};

function ModeIcon({ mode }: { mode: ThemeModePreference }): JSX.Element {
  return (
    <svg
      className="qm-seg__icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[mode]}
    </svg>
  );
}

/** The theme choice as a segmented control: aria-pressed buttons in a sunken track, one pressed. */
export function ThemeModeSeg({ value, onChange, t, icons = false }: ThemeModeSegProps) {
  const current = value ?? "auto";
  return (
    <fieldset className={icons ? "qm-seg qm-seg--icons" : "qm-seg"}>
      <legend>
        <VisuallyHidden>{t("theme.label")}</VisuallyHidden>
      </legend>
      {THEME_PREFERENCES.map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={mode === current}
          aria-label={icons ? t(`theme.${mode}`) : undefined}
          onClick={() => onChange(mode)}
        >
          {icons ? <ModeIcon mode={mode} /> : t(`theme.${mode}`)}
        </button>
      ))}
    </fieldset>
  );
}
