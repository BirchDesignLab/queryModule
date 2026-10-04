import type { ClientSiteConfig } from "@querymodule/core/config";
import { useCallback, useSyncExternalStore } from "react";
import { useServices } from "./services-context.js";

export interface CachedConfigState {
  /** The cached GET /api/v1/config (key ["config"]), or undefined before sign-in, a first load and after reset. */
  config: ClientSiteConfig | undefined;
  /** The fetch failed and left no config to show: a page stops saying "Loading". */
  unavailable: boolean;
}

/**
 * The one reader of the cached live config (#480): the app chrome, the status page and the admin
 * builder's preview all follow the query cache through this hook. The config lives in the cache
 * only (spec 6.7); the header and the panel fill it, the background refresh keeps it current.
 */
export function useCachedConfigState(): CachedConfigState {
  const { queryClient } = useServices();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const config = useSyncExternalStore(subscribe, () =>
    queryClient.getQueryData<ClientSiteConfig>(["config"]),
  );
  const failed = useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryState(["config"])?.status === "error",
  );
  return { config, unavailable: failed && config === undefined };
}

/** Just the config, for callers that do not care why it is missing. */
export function useCachedConfig(): ClientSiteConfig | undefined {
  return useCachedConfigState().config;
}
