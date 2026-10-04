import { type ClientSiteConfig, ClientSiteConfigSchema } from "@querymodule/core/config";
import type { ApiClient } from "../api/create-api-client.js";

/** network: the request never completed; status: a non-2xx answer; parse: a 2xx body that is not the config. */
export type ConfigFetchErrorKind = "network" | "status" | "parse";

/** Carries the kind and HTTP status only, never the response body (spec 5.9). */
export class ConfigFetchError extends Error {
  readonly kind: ConfigFetchErrorKind;
  constructor(kind: ConfigFetchErrorKind, message: string) {
    super(message);
    this.name = "ConfigFetchError";
    this.kind = kind;
  }
}

/** GET /api/v1/config, parsed with the forward-tolerant client schema (unknown keys are stripped). */
export async function fetchClientConfig(
  api: ApiClient,
  options: { background?: boolean } = {},
): Promise<ClientSiteConfig> {
  let status: number;
  let data: unknown;
  try {
    // X-Background: the server does not count the request as user activity (idle timer, spec 5.6).
    const result = await api.GET(
      "/api/v1/config",
      options.background === true ? { headers: { "X-Background": "1" } } : {},
    );
    status = result.response.status;
    data = result.data;
  } catch (error) {
    // The client parses the body inside GET, so a non-JSON body surfaces here as a SyntaxError.
    if (error instanceof SyntaxError)
      throw new ConfigFetchError("parse", "config response invalid");
    throw new ConfigFetchError("network", "config fetch failed");
  }
  if (data === undefined) {
    throw new ConfigFetchError("status", `config fetch failed: ${status}`);
  }
  const parsed = ClientSiteConfigSchema.safeParse(data);
  if (!parsed.success) throw new ConfigFetchError("parse", "config response invalid");
  return parsed.data;
}

/**
 * The live config changes when an admin publishes (ADR-0011) or on a server restart. Open panels
 * refetch every 15 s and on window focus; a 409 configHashMismatch invalidates ["config"] with
 * refetchType "all", so it refetches at once even when no panel observes it (spec 6.7).
 */
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
