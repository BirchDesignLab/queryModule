import type { ApiClient } from "../api/create-api-client.js";
import { isLocaleBundle, type LocaleBundle } from "./translator.js";

/**
 * The bundle could not be read: `status` is the HTTP status, so a caller can tell "no such bundle"
 * (404) from a failure worth surfacing (500, #404). The message stays "localeUnavailable".
 */
export class LocaleUnavailableError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("localeUnavailable");
    this.name = "LocaleUnavailableError";
    this.status = status;
  }
}

/** GET /api/v1/locales/:locale needs no session: the sign-in screen uses it (spec 5.8). */
export async function fetchLocaleBundle(api: ApiClient, locale: string): Promise<LocaleBundle> {
  const { data, response } = await api.GET("/api/v1/locales/{locale}", {
    params: { path: { locale } },
  });
  if (!isLocaleBundle(data)) throw new LocaleUnavailableError(response.status);
  return data;
}
