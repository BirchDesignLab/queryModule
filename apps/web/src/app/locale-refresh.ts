import { fetchLocaleBundle, type LocaleBundle } from "@querymodule/client";
import { useEffect, useRef } from "react";
import { useCachedConfig } from "./cached-config.js";
import { useServices } from "./services-context.js";

/**
 * Fetches the locale bundle again when the cached config changes (a publish or a roll back), so a
 * label added in the builder reaches an open tab without a reload. The first config seen is the
 * baseline: the bundle loaded at boot already matches it. A failed fetch keeps the strings in use.
 */
export function useLocaleRefresh(
  locale: string,
  enabled: boolean,
  onBundle: (bundle: LocaleBundle) => void,
): void {
  const services = useServices();
  const hash = useCachedConfig()?.configHash;
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled || hash === undefined) return;
    if (seen.current === undefined) {
      seen.current = hash;
      return;
    }
    if (seen.current === hash) return;
    seen.current = hash;
    let live = true;
    fetchLocaleBundle(services.api, locale).then(
      (bundle) => {
        if (!live) return;
        services.queryClient.setQueryData(["locale", locale], bundle);
        onBundle(bundle);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [enabled, hash, locale, services, onBundle]);
}
