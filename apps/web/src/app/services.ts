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
  createDraftStore,
  createPreferencesStore,
  createQueryClient,
  createResetController,
  createSessionController,
  type DraftStore,
  type PreferencesStore,
  type ResetController,
  registerQueryCacheReset,
  type SessionController,
  type SignOutMarker,
  type SocketLike,
} from "@querymodule/client";
import { createBrowserSocket } from "../platform/browser-socket.js";
import { createStorageSignOutMarker } from "../platform/sign-out-marker.js";

export interface ServicesOptions {
  baseUrl: string;
  platform: ClientPlatform;
  createSocket?: (url: string) => SocketLike;
  signOutMarker?: SignOutMarker;
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
  drafts: DraftStore;
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
  const session = createSessionController({
    authApi,
    authStore,
    reset,
    signOutMarker: options.signOutMarker ?? createStorageSignOutMarker(),
  });
  const api = createApiClient({
    baseUrl: options.baseUrl,
    platform: options.platform,
    onUnauthenticated: () => session.handleUnauthenticated(),
  });
  const queryClient = createQueryClient();
  const announcer = createAnnouncer();
  const preferences = createPreferencesStore();
  const drafts = createDraftStore();
  registerQueryCacheReset(reset, queryClient);
  reset.register(() => authStore.getState().setSignedOut());
  reset.register(() => announcer.clear());
  reset.register(() => preferences.getState().reset());
  reset.register(() => drafts.getState().reset());
  return {
    platform: options.platform,
    api,
    authApi,
    authStore,
    session,
    queryClient,
    announcer,
    preferences,
    drafts,
    reset,
    createSocket: options.createSocket ?? createBrowserSocket,
  };
}
