import type { ApiClient } from "../api/create-api-client.js";
import { isLocaleBundle, type LocaleBundle } from "./translator.js";

/** GET /api/v1/locales/:locale needs no session: the sign-in screen uses it (spec 5.8). */
export async function fetchLocaleBundle(api: ApiClient, locale: string): Promise<LocaleBundle> {
  const { data } = await api.GET("/api/v1/locales/{locale}", { params: { path: { locale } } });
  if (!isLocaleBundle(data)) throw new Error("localeUnavailable");
  return data;
}
