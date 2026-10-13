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
  createFeedSocket,
  createPreferencesStore,
  createQueryClient,
  createRequestsStore,
  createResetController,
  createResultFetcher,
  createSessionController,
  createSubmitController,
  type DraftStore,
  type FeedSocket,
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
import { heartbeatUrl } from "../status/use-status-checks.js";

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
  /** The live feed of per-source status events; AppShell opens it while signed in (spec 6.7, 6.8). */
  feed: FeedSocket;
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
    // D-A26: a temporary password must be changed before any other screen shows.
    onPasswordChangeRequired: () => authStore.getState().setPasswordChangeRequired(true),
  });
  const queryClient = createQueryClient();
  const announcer = createAnnouncer();
  const preferences = createPreferencesStore();
  const drafts = createDraftStore();
  const submit = createSubmitController({ api, queryClient, online: options.platform.online });
  // One timer seam for the feed and the requests store (the store's coalescing windows).
  const timers = {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: unknown) => globalThis.clearTimeout(id as number),
  };
  const requests = createRequestsStore({ timers });
  const configRefresh = createConfigRefresh({ api, queryClient, platform: options.platform });
  const createSocket = options.createSocket ?? createBrowserSocket;
  const feed = createFeedSocket({
    createSocket,
    url: heartbeatUrl(location),
    timers,
    random: Math.random,
  });
  // Fetches each request's payloads when its sources settle (spec 6.7); memory only, reset below.
  const results = createResultFetcher({ api, timers, store: requests });
  // Status events land in the requests store, which holds the ones that outrun their 202 (spec 6.7).
  feed.onSourceStatus((event) => {
    requests.getState().applyEvent(event);
    results.handleEvent(event);
  });
  // Replay by cursor is the feed's own (spec 4.7); what it cannot replay, or what was missed while the
  // socket was down, is refetched here (spec 6.8): a `resync` reloads the list, and every reconnect
  // and every backoff step while down refetches the entries that still have a pending source.
  feed.onResync(() => {
    void results.loadList();
  });
  feed.onReconnect(() => results.refetchPending());
  feed.onRetry(() => results.refetchPending());
  // Sign-in (Q1) loads the list: the last requests of the user's other sessions and devices. A session
  // still owing a password change loads nothing until it is changed (D-A26); a reset empties it all.
  const listable = (state: ReturnType<AuthStore["getState"]>): boolean =>
    state.status === "signedIn" && !state.passwordChangeRequired;
  authStore.subscribe((state, previous) => {
    if (!listable(state)) return;
    if (listable(previous) && previous.user?.id === state.user?.id) return;
    void results.loadList();
  });
  registerQueryCacheReset(reset, queryClient);
  reset.register(() => feed.close());
  reset.register(() => configRefresh.stop());
  reset.register(() => authStore.getState().setSignedOut());
  reset.register(() => announcer.clear());
  reset.register(() => preferences.getState().reset());
  reset.register(() => drafts.getState().reset());
  reset.register(() => submit.getState().reset());
  reset.register(() => results.reset());
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
    feed,
    reset,
    createSocket,
  };
}
