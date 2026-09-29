import type { ClientSiteConfig } from "@querymodule/core/config";
import { useCallback, useSyncExternalStore } from "react";
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
