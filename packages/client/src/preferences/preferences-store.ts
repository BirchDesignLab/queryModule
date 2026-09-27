import { createStore, type StoreApi } from "zustand/vanilla";

export const THEME_PREFERENCES = ["auto", "day", "night", "redShift"] as const;
export type ThemeModePreference = (typeof THEME_PREFERENCES)[number];

export function isThemeModePreference(value: unknown): value is ThemeModePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export interface PreferencesSnapshot {
  themeMode: ThemeModePreference | null;
  personaOverride: string | null;
}

export interface PreferencesState extends PreferencesSnapshot {
  setThemeMode(themeMode: ThemeModePreference | null): void;
  setPersonaOverride(personaOverride: string | null): void;
  hydrate(snapshot: PreferencesSnapshot): void;
  reset(): void;
}

export type PreferencesStore = StoreApi<PreferencesState>;

const EMPTY: PreferencesSnapshot = { themeMode: null, personaOverride: null };

export function createPreferencesStore(): PreferencesStore {
  return createStore<PreferencesState>()((set) => ({
    ...EMPTY,
    setThemeMode: (themeMode) => set({ themeMode }),
    setPersonaOverride: (personaOverride) => set({ personaOverride }),
    hydrate: (snapshot) => set({ ...snapshot }),
    reset: () => set({ ...EMPTY }),
  }));
}
