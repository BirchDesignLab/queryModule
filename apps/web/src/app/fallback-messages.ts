import type { LocaleBundle } from "@querymodule/client";

/** Only for the boot error screen, when GET /api/v1/locales fails; kept equal to en.json by a test. */
export const FALLBACK_MESSAGES: LocaleBundle = {
  "error.unavailable": "The service is unavailable. Try again.",
  "error.localeUnavailable": "Language data is unavailable. Try again.",
  "error.metaUnavailable": "Service information is unavailable. Try again.",
  "app.retry": "Retry",
  "app.title": "Query Module",
};
