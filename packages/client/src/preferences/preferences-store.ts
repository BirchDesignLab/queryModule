import { createStore, type StoreApi } from "zustand/vanilla";

export const THEME_PREFERENCES = ["auto", "day", "night", "redShift"] as const;
export type ThemeModePreference = (typeof THEME_PREFERENCES)[number];

export function isThemeModePreference(value: unknown): value is ThemeModePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** UX-014, spec 5.5 user_preference.layout: both fields are always stored together. */
export interface PreferenceLayout {
  orientation: "horizontal" | "vertical";
  terminal: "toggle" | "pane";
}

export function isPreferenceLayout(value: unknown): value is PreferenceLayout {
  if (typeof value !== "object" || value === null) return false;
  const { orientation, terminal } = value as Record<string, unknown>;
  return (
    (orientation === "horizontal" || orientation === "vertical") &&
    (terminal === "toggle" || terminal === "pane")
  );
}

export interface PreferencesSnapshot {
  themeMode: ThemeModePreference | null;
  personaOverride: string | null;
  /** Null until the user picks one; the app then behaves as { horizontal, toggle }. */
  layout: PreferenceLayout | null;
}

export interface PreferencesState extends PreferencesSnapshot {
  setThemeMode(themeMode: ThemeModePreference | null): void;
  setPersonaOverride(personaOverride: string | null): void;
  setLayout(layout: PreferenceLayout | null): void;
  hydrate(snapshot: PreferencesSnapshot): void;
  reset(): void;
}

export type PreferencesStore = StoreApi<PreferencesState>;

const EMPTY: PreferencesSnapshot = { themeMode: null, personaOverride: null, layout: null };

export function createPreferencesStore(): PreferencesStore {
  return createStore<PreferencesState>()((set) => ({
    ...EMPTY,
    setThemeMode: (themeMode) => set({ themeMode }),
    setPersonaOverride: (personaOverride) => set({ personaOverride }),
    setLayout: (layout) => set({ layout }),
    hydrate: (snapshot) => set({ ...snapshot }),
    reset: () => set({ ...EMPTY }),
  }));
}
