import { describe, expect, it } from "vitest";
import { createPreferencesStore, isThemeModePreference } from "./preferences-store.js";

describe("UX-014 preferences held in memory until the server copy loads (spec 5.5, 6.7)", () => {
  it("starts empty, updates and resets", () => {
    const store = createPreferencesStore();
    expect(store.getState()).toMatchObject({ themeMode: null, personaOverride: null });
    store.getState().setThemeMode("redShift");
    store.getState().setPersonaOverride("records");
    expect(store.getState()).toMatchObject({ themeMode: "redShift", personaOverride: "records" });
    store.getState().reset();
    expect(store.getState()).toMatchObject({ themeMode: null, personaOverride: null });
  });
  it("hydrates from a snapshot", () => {
    const store = createPreferencesStore();
    store.getState().hydrate({ themeMode: "night", personaOverride: null });
    expect(store.getState().themeMode).toBe("night");
  });
  it("guards theme preference values", () => {
    expect(isThemeModePreference("auto")).toBe(true);
    expect(isThemeModePreference("sepia")).toBe(false);
  });
});
