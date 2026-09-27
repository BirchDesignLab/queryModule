import { QueryClient } from "@tanstack/react-query";
import type { ResetController } from "../session/reset.js";

/** Memory only: no persister, ever (spec 6.7). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 0, gcTime: 300_000, refetchOnWindowFocus: false },
    },
  });
}

/**
 * Registers the query cache with the reset controller so logout, a 401 or a user change
 * cancels in-flight queries and clears every cached result (SEC-006, spec 6.7).
 */
export function registerQueryCacheReset(reset: ResetController, client: QueryClient): () => void {
  return reset.register(() => {
    void client.cancelQueries();
    client.clear();
  });
}
