import createClient, { type Client, type Middleware } from "openapi-fetch";
import type { ClientPlatform } from "../platform.js";
import type { paths } from "./generated/openapi-types.js";

export type ApiClient = Client<paths>;
export const REQUESTED_WITH = "querymodule";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ApiClientOptions {
  baseUrl: string;
  platform: ClientPlatform;
  /** Called on any 401; the session controller resets client state (spec 6.7). */
  onUnauthenticated: () => void;
  /** Called on a 403 passwordChangeRequired (D-A26): the user must choose a new password first. */
  onPasswordChangeRequired?: () => void;
  fetch?: (request: Request) => Promise<Response>;
}

/** CSRF header on state-changing requests (spec 5.9); bearer header only for native (spec 5.6). */
export async function applyRequestHeaders(
  request: Request,
  platform: ClientPlatform,
): Promise<Request> {
  if (STATE_CHANGING.has(request.method)) request.headers.set("X-Requested-With", REQUESTED_WITH);
  if (platform.authTransport === "bearer" && platform.tokenStore !== null) {
    const token = await platform.tokenStore.get();
    if (token !== null) request.headers.set("Authorization", `Bearer ${token}`);
  }
  return request;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    cache: "no-store",
    credentials: options.platform.authTransport === "cookie" ? "include" : "omit",
    fetch: options.fetch ?? ((request: Request) => globalThis.fetch(request)),
  });
  const middleware: Middleware = {
    onRequest: ({ request }) => applyRequestHeaders(request, options.platform),
    onResponse: async ({ response }) => {
      if (response.status === 401) options.onUnauthenticated();
      else if (response.status === 403 && options.onPasswordChangeRequired !== undefined) {
        const body: unknown = await response
          .clone()
          .json()
          .catch(() => null);
        const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
        if (code === "passwordChangeRequired") options.onPasswordChangeRequired();
      }
      return response;
    },
  };
  client.use(middleware);
  return client;
}
