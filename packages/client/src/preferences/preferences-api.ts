import type { ApiClient } from "../api/create-api-client.js";
import {
  isThemeModePreference,
  type PreferencesSnapshot,
  type PreferencesStore,
} from "./preferences-store.js";

export async function loadPreferences(api: ApiClient, store: PreferencesStore): Promise<void> {
  const { data } = await api.GET("/api/v1/me/preferences");
  if (data === undefined) return;
  store.getState().hydrate({
    themeMode: isThemeModePreference(data.themeMode) ? data.themeMode : null,
    personaOverride: typeof data.personaOverride === "string" ? data.personaOverride : null,
  });
}

/** PUT replaces the row, so the patch is merged into the current server copy first. */
export async function savePreferences(
  api: ApiClient,
  patch: Partial<PreferencesSnapshot>,
): Promise<boolean> {
  const current = await api.GET("/api/v1/me/preferences");
  if (current.data === undefined) return false;
  const { response } = await api.PUT("/api/v1/me/preferences", {
    body: { ...current.data, ...patch },
  });
  return response.ok;
}
