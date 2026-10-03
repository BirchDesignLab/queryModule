import { createStore, type StoreApi } from "zustand/vanilla";
import type { SessionUser } from "./auth-api.js";

export type AuthStatus = "unknown" | "signedOut" | "signedIn";

export interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  /** The last sign-out cleared this device but the server did not confirm it (SEC-006). */
  signOutFailed: boolean;
  /** The API answered 403 passwordChangeRequired: only the new-password screen shows (D-A26). */
  passwordChangeRequired: boolean;
  setPasswordChangeRequired(required: boolean): void;
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
    passwordChangeRequired: false,
    setPasswordChangeRequired: (passwordChangeRequired) => set({ passwordChangeRequired }),
    // D-A26: the session itself says whether the password must change, so the shell never renders
    // before the first 403 passwordChangeRequired (#505 T34 M1); that 403 still sets it too.
    setSignedIn: (user) =>
      set({
        status: "signedIn",
        user,
        signOutFailed: false,
        passwordChangeRequired: user.mustChangePassword === true,
      }),
    setSignedOut: () => set({ status: "signedOut", user: null, passwordChangeRequired: false }),
    setSignOutFailed: (signOutFailed) => set({ signOutFailed }),
  }));
}
