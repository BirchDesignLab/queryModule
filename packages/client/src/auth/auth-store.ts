import { createStore, type StoreApi } from "zustand/vanilla";
import type { SessionUser } from "./auth-api.js";

export type AuthStatus = "unknown" | "signedOut" | "signedIn";

export interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  /** The last sign-out cleared this device but the server did not confirm it (SEC-006). */
  signOutFailed: boolean;
  setSignedIn(user: SessionUser): void;
  setSignedOut(): void;
  setSignOutFailed(failed: boolean): void;
}

export type AuthStore = StoreApi<AuthState>;

export function createAuthStore(): AuthStore {
  return createStore<AuthState>()((set) => ({
    status: "unknown",
    user: null,
    signOutFailed: false,
    setSignedIn: (user) => set({ status: "signedIn", user, signOutFailed: false }),
    setSignedOut: () => set({ status: "signedOut", user: null }),
    setSignOutFailed: (signOutFailed) => set({ signOutFailed }),
  }));
}
