import {
  createTranslator,
  fetchLocaleBundle,
  fetchMeta,
  isClientSupported,
  loadPreferences,
  type Translator,
} from "@querymodule/client";
import { FALLBACK_MESSAGES } from "./fallback-messages.js";
import type { Services } from "./services.js";

export type BootState =
  | { status: "ready"; translator: Translator; clientSupported: boolean }
  | { status: "failed"; translator: Translator; message: string };

/** fetchMeta/fetchLocaleBundle throw Error("metaUnavailable")/Error("localeUnavailable")
 * (packages/client/src/meta/version.ts, packages/client/src/i18n/locale-api.ts); anything
 * else (e.g. a session.bootstrap() failure) falls back to the generic key. */
function failureKey(error: unknown): string {
  if (error instanceof Error && error.message === "localeUnavailable")
    return "error.localeUnavailable";
  if (error instanceof Error && error.message === "metaUnavailable") return "error.metaUnavailable";
  return "error.unavailable";
}

/** Version check and strings precede login (spec 5.1, 5.8, 6.7); then the existing session, if any. */
export async function bootstrap(
  services: Services,
  clientVersion: string,
  locale = "en",
): Promise<BootState> {
  try {
    const [meta, bundle] = await Promise.all([
      fetchMeta(services.api),
      fetchLocaleBundle(services.api, locale),
    ]);
    await services.session.bootstrap();
    if (services.authStore.getState().status === "signedIn") {
      await loadPreferences(services.api, services.preferences).catch(() => undefined);
    }
    return {
      status: "ready",
      translator: createTranslator(locale, bundle),
      clientSupported: isClientSupported(clientVersion, meta.minClientVersion ?? null),
    };
  } catch (error) {
    // No bundle is loaded once either fetch has failed, so the message is resolved
    // through FALLBACK_MESSAGES (B4 carry-forward, ruling IC3).
    const translator = createTranslator(locale, FALLBACK_MESSAGES);
    return { status: "failed", translator, message: translator.t(failureKey(error)) };
  }
}
