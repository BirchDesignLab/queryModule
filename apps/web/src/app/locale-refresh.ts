import { fetchLocaleBundle, type LocaleBundle } from "@querymodule/client";
import { useEffect, useRef } from "react";
import { useCachedConfig } from "./cached-config.js";
import { useServices } from "./services-context.js";

/**
 * Fetches the locale bundle again when the cached config changes (a publish or a roll back), so a
 * label added in the builder reaches an open tab without a reload. The first config seen is the
 * baseline: the bundle loaded at boot is taken to match it (a publish while the sign-in page was
 * open is the one gap; a reload closes it). The baseline moves only once the new bundle is in, so a
 * failed or cancelled fetch is tried again on the next change, and a failure keeps the strings in use.
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
    let live = true;
    fetchLocaleBundle(services.api, locale).then(
      (bundle) => {
        if (!live) return;
        seen.current = hash;
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
