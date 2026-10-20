import { fetchLocaleBundle, type LocaleBundle } from "@querymodule/client";
import { useEffect, useRef } from "react";
import { useCachedConfig } from "./cached-config.js";
import { useServices } from "./services-context.js";

/**
 * Fetches the locale bundle again when the cached config changes (a publish or a roll back), so a
 * label added in the builder reaches an open tab without a reload. A change is a new configHash or
 * a new published versionId: a label-only publish keeps the hash (#46 CFG-1, CFG-3). The bundle
 * lives in the query cache only, never in storage (spec 6.7). The first config seen is the
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
  const config = useCachedConfig();
  const configKey = config === undefined ? undefined : `${config.configHash}:${config.versionId}`;
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled || configKey === undefined) return;
    if (seen.current === undefined) {
      seen.current = configKey;
      return;
    }
    if (seen.current === configKey) return;
    let live = true;
    fetchLocaleBundle(services.api, locale).then(
      (bundle) => {
        if (!live) return;
        seen.current = configKey;
        services.queryClient.setQueryData(["locale", locale], bundle);
        onBundle(bundle);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [enabled, configKey, locale, services, onBundle]);
}
