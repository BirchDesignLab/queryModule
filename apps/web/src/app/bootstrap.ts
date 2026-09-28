import {
  createTranslator,
  fetchLocaleBundle,
  fetchMeta,
  isClientSupported,
  type Translator,
} from "@querymodule/client";
import { FALLBACK_MESSAGES } from "./fallback-messages.js";
import type { Services } from "./services.js";

export type BootState =
  | { status: "ready"; translator: Translator; clientSupported: boolean }
  | { status: "failed"; translator: Translator };

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
    return {
      status: "ready",
      translator: createTranslator(locale, bundle),
      clientSupported: isClientSupported(clientVersion, meta.minClientVersion ?? null),
    };
  } catch {
    return { status: "failed", translator: createTranslator(locale, FALLBACK_MESSAGES) };
  }
}
