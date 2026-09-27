import { QueryClient } from "@tanstack/react-query";

/** Memory only: no persister, ever (spec 6.7). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 0, gcTime: 300_000, refetchOnWindowFocus: false },
    },
  });
}
