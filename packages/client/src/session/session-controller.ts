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
  const adopt = (user: SessionUser | null): void => {
    const previous = authStore.getState().user;
    if (previous !== null && (user === null || user.id !== previous.id)) reset.resetAll();
    if (user === null) authStore.getState().setSignedOut();
    else authStore.getState().setSignedIn(user);
  };
  return {
    async bootstrap() {
      adopt(await authApi.getSession());
    },
    async signIn(email, password) {
      const result = await authApi.signInEmail(email, password);
      if (result.ok) adopt(result.user);
      return result;
    },
    async signOut() {
      try {
        await authApi.signOut();
      } finally {
        adopt(null);
      }
    },
    handleUnauthenticated() {
      if (authStore.getState().status === "signedIn") adopt(null);
    },
  };
}
