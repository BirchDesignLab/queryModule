import type { SignOutMarker } from "@querymodule/client";

export const SIGN_OUT_PENDING_KEY = "qm.signOutPending";

/**
 * #241: remembers that the server never confirmed a sign-out, so the next boot retries it
 * before adopting the still-valid session cookie. localStorage, not sessionStorage: the next
 * person on a shared device opens a new tab. It holds one flag, never user or query data
 * (spec 3, 6.7). Storage can be missing, disabled or full; every access is guarded and a
 * failure falls back to the in-memory notice of #235.
 */
export function createStorageSignOutMarker(
  storage: () => Storage | undefined = () => globalThis.localStorage,
): SignOutMarker {
  const run = <T>(action: (s: Storage) => T, fallback: T): T => {
    try {
      const s = storage();
      return s === undefined ? fallback : action(s);
    } catch {
      return fallback;
    }
  };
  return {
    isSet: () => run((s) => s.getItem(SIGN_OUT_PENDING_KEY) === "1", false),
    set: () => run((s) => s.setItem(SIGN_OUT_PENDING_KEY, "1"), undefined),
    clear: () => run((s) => s.removeItem(SIGN_OUT_PENDING_KEY), undefined),
  };
}
