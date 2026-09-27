import type { AuthApi, SessionUser, SignInResult } from "../auth/auth-api.js";
import type { AuthStore } from "../auth/auth-store.js";
import type { ResetController } from "./reset.js";

export interface SessionController {
  bootstrap(): Promise<void>;
  signIn(email: string, password: string): Promise<SignInResult>;
  signOut(): Promise<void>;
  handleUnauthenticated(): void;
}

export interface SessionControllerDeps {
  authApi: AuthApi;
  authStore: AuthStore;
  reset: ResetController;
}

/** Logout, a 401 or a change of user id clears every store before anything else renders (spec 6.7). */
export function createSessionController({
  authApi,
  authStore,
  reset,
}: SessionControllerDeps): SessionController {
  // Bumped at the start of every bootstrap/signIn/signOut/handleUnauthenticated so a stale
  // in-flight response (e.g. a slow getSession from a prior identity) is dropped, not adopted
  // over a newer state (spec 6.7).
  let epoch = 0;
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
      const user = await authApi.getSession();
      if (epoch !== startEpoch) return;
      adopt(user);
    },
    async signIn(email, password) {
      const startEpoch = ++epoch;
      const result = await authApi.signInEmail(email, password);
      if (result.ok && epoch === startEpoch) adopt(result.user);
      return result;
    },
    async signOut() {
      ++epoch;
      try {
        await authApi.signOut();
      } finally {
        adopt(null);
      }
    },
    handleUnauthenticated() {
      ++epoch;
      if (authStore.getState().status === "signedIn") adopt(null);
    },
  };
}
