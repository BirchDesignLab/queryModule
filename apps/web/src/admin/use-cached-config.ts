import { fetchClientConfig } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useServices } from "../app/services-context.js";

/** The cached GET /api/v1/config (key ["config"]); the header prefetches it, so no new call. */
export function useCachedClientConfig(): ClientSiteConfig | undefined {
  const { queryClient } = useServices();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  return useSyncExternalStore(subscribe, () =>
    queryClient.getQueryData<ClientSiteConfig>(["config"]),
  );
}

/** The cached config's fetch failed and left no data: the preview stops waiting for it. */
export function useCachedConfigFailed(): boolean {
  const { queryClient } = useServices();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  return useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryState(["config"])?.status === "error",
  );
}

export type LiveCheck = "checking" | "done" | "failed";

/**
 * The live config for the Changes view: the cached one, checked against the server once when the
 * view opens (it is polled only every 15 s otherwise). A newer answer replaces the cache the way the
 * background refresh does; a failed check leaves the config in hand and says so.
 */
export function useLiveConfig(): { config: ClientSiteConfig | undefined; check: LiveCheck } {
  const { api, queryClient } = useServices();
  const config = useCachedClientConfig();
  const [check, setCheck] = useState<LiveCheck>("checking");
  useEffect(() => {
    let open = true;
    fetchClientConfig(api).then(
      (next) => {
        if (!open) return;
        const current = queryClient.getQueryData<ClientSiteConfig>(["config"]);
        if (current === undefined || current.configHash !== next.configHash)
          queryClient.setQueryData(["config"], next);
        setCheck("done");
      },
      () => {
        if (open) setCheck("failed");
      },
    );
    return () => {
      open = false;
    };
  }, [api, queryClient]);
  return { config, check };
}
