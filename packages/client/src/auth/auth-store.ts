import { createStore, type StoreApi } from "zustand/vanilla";
import type { SessionUser } from "./auth-api.js";

export type AuthStatus = "unknown" | "signedOut" | "signedIn";

export interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  setSignedIn(user: SessionUser): void;
  setSignedOut(): void;
}

export type AuthStore = StoreApi<AuthState>;

export function createAuthStore(): AuthStore {
  return createStore<AuthState>()((set) => ({
    status: "unknown",
    user: null,
    setSignedIn: (user) => set({ status: "signedIn", user }),
    setSignedOut: () => set({ status: "signedOut", user: null }),
  }));
}
