import type { ThemeMode } from "./tokens";

export type ThemePreference = ThemeMode | "auto";

export interface ThemeSelection {
  defaultMode: ThemeMode;
  auto: "off" | "os" | "time";
}

export interface ThemeModeInput {
  preference: ThemePreference | null;
  /** SiteConfig.theme once config is loaded; null before (login screen, all of P1). */
  selection: ThemeSelection | null;
  osPrefersDark: boolean;
  /** Local hour 0 to 23, for auto "time" (night from 19:00 to 07:00). */
  localHour: number;
}

function fromOs(osPrefersDark: boolean): ThemeMode {
  return osPrefersDark ? "night" : "day";
}

/** UX-002, spec 6.5: an explicit preference wins; with no site theme loaded the OS scheme decides. */
export function resolveThemeMode({
  preference,
  selection,
  osPrefersDark,
  localHour,
}: ThemeModeInput): ThemeMode {
  if (preference !== null && preference !== "auto") return preference;
  if (selection === null) return fromOs(osPrefersDark);
  if (preference === null) return selection.defaultMode;
  switch (selection.auto) {
    case "os":
      return fromOs(osPrefersDark);
    case "time":
      return localHour >= 19 || localHour < 7 ? "night" : "day";
    case "off":
      return selection.defaultMode;
  }
}
