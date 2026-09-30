import {
  type Announcer,
  type ApiClient,
  type AuthApi,
  type AuthStore,
  type ClientPlatform,
  type ConfigRefresh,
  createAnnouncer,
  createApiClient,
  createAuthApi,
  createAuthStore,
  createConfigRefresh,
  createDraftStore,
  createPreferencesStore,
  createQueryClient,
  createRequestsStore,
  createResetController,
  createSessionController,
  createSubmitController,
  type DraftStore,
  type PreferencesStore,
  type RequestsStore,
  type ResetController,
  registerQueryCacheReset,
  type SessionController,
  type SignOutMarker,
  type SocketLike,
  type SubmitController,
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
  submit: SubmitController;
  /** This session's requests and their acknowledgments, in memory only (spec 6.7). */
  requests: RequestsStore;
  /** Keeps the cached config current while signed in (ADR-0011 item 3); AppShell starts it. */
  configRefresh: ConfigRefresh;
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
  const submit = createSubmitController({ api, queryClient, online: options.platform.online });
  const requests = createRequestsStore();
  const configRefresh = createConfigRefresh({ api, queryClient, platform: options.platform });
  registerQueryCacheReset(reset, queryClient);
  reset.register(() => configRefresh.stop());
  reset.register(() => authStore.getState().setSignedOut());
  reset.register(() => announcer.clear());
  reset.register(() => preferences.getState().reset());
  reset.register(() => drafts.getState().reset());
  reset.register(() => submit.getState().reset());
  reset.register(() => requests.getState().reset());
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
    submit,
    requests,
    configRefresh,
    reset,
    createSocket: options.createSocket ?? createBrowserSocket,
  };
}
