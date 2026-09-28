import { type ClientSiteConfig, ClientSiteConfigSchema } from "@querymodule/core/config";
import type { ApiClient } from "../api/create-api-client.js";

/** Carries the HTTP status only, never the response body (spec 5.9). */
export class ConfigFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigFetchError";
  }
}

/** GET /api/v1/config, parsed with the forward-tolerant client schema (unknown keys are stripped). */
export async function fetchClientConfig(api: ApiClient): Promise<ClientSiteConfig> {
  let status: number;
  let data: unknown;
  try {
    const result = await api.GET("/api/v1/config");
    status = result.response.status;
    data = result.data;
  } catch {
    throw new ConfigFetchError("config fetch failed");
  }
  if (data === undefined) throw new ConfigFetchError(`config fetch failed: ${status}`);
  const parsed = ClientSiteConfigSchema.safeParse(data);
  if (!parsed.success) throw new ConfigFetchError("config response invalid");
  return parsed.data;
}

/** Config changes only on a server restart; a 409 configHashMismatch invalidates ["config"]. */
export function clientConfigQuery(api: ApiClient): {
  queryKey: readonly ["config"];
  queryFn: () => Promise<ClientSiteConfig>;
  staleTime: number;
} {
  return {
    queryKey: ["config"] as const,
    queryFn: () => fetchClientConfig(api),
    staleTime: Number.POSITIVE_INFINITY,
  };
}
