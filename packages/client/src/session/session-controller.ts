import type { AuthApi, SessionUser, SignInResult } from "../auth/auth-api.js";
import type { AuthStore } from "../auth/auth-store.js";
import type { ResetController } from "./reset.js";

export interface SessionController {
  bootstrap(): Promise<void>;
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Rejects when the server did not end the session; local state is wiped either way. */
  signOut(): Promise<void>;
  /**
   * Repeats the server sign-out after a failed one; clears signOutFailed on success. Resolves
   * false when a sign-in started meanwhile: the retry was aborted and its result ignored (W4).
   */
  retrySignOut(): Promise<boolean>;
  handleUnauthenticated(): void;
}

/**
 * Remembers across a reload that the server never confirmed a sign-out (#241), so the next
 * boot retries it before adopting any session. The platform supplies it (web: browser
 * storage); it holds a flag only, never user or query data (spec 3, 6.7).
 */
export interface SignOutMarker {
  isSet(): boolean;
  set(): void;
  clear(): void;
}

const noMarker: SignOutMarker = { isSet: () => false, set: () => {}, clear: () => {} };

export interface SessionControllerDeps {
  authApi: AuthApi;
  authStore: AuthStore;
  reset: ResetController;
  signOutMarker?: SignOutMarker;
}

/** Logout, a 401 or a change of user id clears every store before anything else renders (spec 6.7). */
export function createSessionController({
  authApi,
  authStore,
  reset,
  signOutMarker = noMarker,
}: SessionControllerDeps): SessionController {
  // Bumped at the start of every bootstrap/signIn/signOut/handleUnauthenticated so a stale
  // in-flight response (e.g. a slow getSession from a prior identity) is dropped, not adopted
  // over a newer state (spec 6.7).
  let epoch = 0;
  // The in-flight retrySignOut, aborted by a new sign-in so its late response is dropped (W4).
  let retryAbort: AbortController | null = null;
  const adopt = (user: SessionUser | null): void => {
    let resetError: unknown;
    try {
      const previous = authStore.getState().user;
      if (previous !== null && (user === null || user.id !== previous.id)) reset.resetAll();
    } catch (error) {
      resetError = error;
    } finally {
      if (user === null) authStore.getState().setSignedOut();
      else authStore.getState().setSignedIn(user);
    }
    if (resetError !== undefined) throw resetError;
  };
  return {
    async bootstrap() {
      const startEpoch = ++epoch;
      if (signOutMarker.isSet()) {
        // A sign-out the server never confirmed (#241): end that session before adopting any.
        try {
          await authApi.signOut();
        } catch {
          if (epoch === startEpoch) {
            authStore.getState().setSignOutFailed(true);
            adopt(null);
          }
          return;
        }
        signOutMarker.clear();
        if (epoch !== startEpoch) return;
      }
      const user = await authApi.getSession();
      if (epoch !== startEpoch) return;
      adopt(user);
    },
    async signIn(email, password) {
      const startEpoch = ++epoch;
      retryAbort?.abort();
      const result = await authApi.signInEmail(email, password);
      if (result.ok && epoch === startEpoch) {
        adopt(result.user);
        signOutMarker.clear();
      }
      return result;
    },
    async signOut() {
      ++epoch;
      let failed = true;
      try {
        await authApi.signOut();
        failed = false;
      } finally {
        // Flag first (a reset error in adopt must not lose it), then wipe this device even when
        // the server call failed; a failure still rethrows (SEC-006).
        authStore.getState().setSignOutFailed(failed);
        if (failed) signOutMarker.set();
        else signOutMarker.clear();
        adopt(null);
      }
    },
    async retrySignOut() {
      const startEpoch = epoch;
      const controller = new AbortController();
      retryAbort = controller;
      try {
        await authApi.signOut({ signal: controller.signal });
      } catch (error) {
        if (epoch !== startEpoch) return false;
        throw error;
      } finally {
        if (retryAbort === controller) retryAbort = null;
      }
      if (epoch !== startEpoch) return false;
      signOutMarker.clear();
      authStore.getState().setSignOutFailed(false);
      return true;
    },
    handleUnauthenticated() {
      ++epoch;
      if (authStore.getState().status === "signedIn") adopt(null);
    },
  };
}
