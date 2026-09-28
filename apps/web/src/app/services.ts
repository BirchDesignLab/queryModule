import {
  type Announcer,
  type ApiClient,
  type AuthApi,
  type AuthStore,
  type ClientPlatform,
  createAnnouncer,
  createApiClient,
  createAuthApi,
  createAuthStore,
  createPreferencesStore,
  createQueryClient,
  createResetController,
  createSessionController,
  type PreferencesStore,
  type ResetController,
  registerQueryCacheReset,
  type SessionController,
  type SocketLike,
} from "@querymodule/client";
import { createBrowserSocket } from "../platform/browser-socket.js";

export interface ServicesOptions {
  baseUrl: string;
  platform: ClientPlatform;
  createSocket?: (url: string) => SocketLike;
}

export interface Services {
  platform: ClientPlatform;
  api: ApiClient;
  authApi: AuthApi;
  authStore: AuthStore;
  session: SessionController;
  queryClient: ReturnType<typeof createQueryClient>;
  announcer: Announcer;
  preferences: PreferencesStore;
  reset: ResetController;
  createSocket: (url: string) => SocketLike;
}

/**
 * Composition root: one instance per page load; every store registers its reset (spec 6.7).
 * The query cache goes through registerQueryCacheReset so a logout, a 401 or a user change
 * cancels in-flight queries before clearing cached results (SEC-006).
 */
export function createServices(options: ServicesOptions): Services {
  const reset = createResetController();
  const authStore = createAuthStore();
  const authApi = createAuthApi({ baseUrl: options.baseUrl });
  const session = createSessionController({ authApi, authStore, reset });
  const api = createApiClient({
    baseUrl: options.baseUrl,
    platform: options.platform,
    onUnauthenticated: () => session.handleUnauthenticated(),
  });
  const queryClient = createQueryClient();
  const announcer = createAnnouncer();
  const preferences = createPreferencesStore();
  registerQueryCacheReset(reset, queryClient);
  reset.register(() => authStore.getState().setSignedOut());
  reset.register(() => announcer.clear());
  reset.register(() => preferences.getState().reset());
  return {
    platform: options.platform,
    api,
    authApi,
    authStore,
    session,
    queryClient,
    announcer,
    preferences,
    reset,
    createSocket: options.createSocket ?? createBrowserSocket,
  };
}
