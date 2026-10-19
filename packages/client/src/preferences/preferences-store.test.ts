import { describe, expect, it } from "vitest";
import {
  createPreferencesStore,
  isPreferenceLayout,
  isThemeModePreference,
} from "./preferences-store.js";

describe("UX-014 preferences held in memory until the server copy loads (spec 5.5, 6.7)", () => {
  it("starts empty, updates and resets", () => {
    const store = createPreferencesStore();
    expect(store.getState()).toMatchObject({
      themeMode: null,
      personaOverride: null,
      layout: null,
    });
    store.getState().setThemeMode("redShift");
    store.getState().setPersonaOverride("records");
    store.getState().setLayout({ orientation: "vertical", terminal: "pane" });
    expect(store.getState()).toMatchObject({
      themeMode: "redShift",
      personaOverride: "records",
      layout: { orientation: "vertical", terminal: "pane" },
    });
    store.getState().reset();
    expect(store.getState()).toMatchObject({
      themeMode: null,
      personaOverride: null,
      layout: null,
    });
  });
  it("hydrates from a snapshot", () => {
    const store = createPreferencesStore();
    store.getState().hydrate({
      themeMode: "night",
      personaOverride: null,
      layout: { orientation: "horizontal", terminal: "pane" },
    });
    expect(store.getState().themeMode).toBe("night");
    expect(store.getState().layout).toEqual({ orientation: "horizontal", terminal: "pane" });
  });
  it("guards the layout value from the server", () => {
    expect(isPreferenceLayout({ orientation: "horizontal", terminal: "toggle" })).toBe(true);
    expect(isPreferenceLayout(null)).toBe(false);
    expect(isPreferenceLayout({ orientation: "horizontal" })).toBe(false);
    expect(isPreferenceLayout({ orientation: "diagonal", terminal: "pane" })).toBe(false);
    expect(isPreferenceLayout({ orientation: "vertical", terminal: "split" })).toBe(false);
  });
  it("guards theme preference values", () => {
    expect(isThemeModePreference("auto")).toBe(true);
    expect(isThemeModePreference("sepia")).toBe(false);
  });
});
