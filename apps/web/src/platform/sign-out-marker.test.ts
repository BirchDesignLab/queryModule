import { describe, expect, it } from "vitest";
import { createStorageSignOutMarker, SIGN_OUT_PENDING_KEY } from "./sign-out-marker.js";

describe("#241 sign-out pending marker in browser storage", () => {
  it("sets, reads and clears one flag under its own key", () => {
    const marker = createStorageSignOutMarker();
    expect(marker.isSet()).toBe(false);
    marker.set();
    expect(localStorage.getItem(SIGN_OUT_PENDING_KEY)).toBe("1");
    expect(createStorageSignOutMarker().isSet()).toBe(true);
    marker.clear();
    expect(localStorage.getItem(SIGN_OUT_PENDING_KEY)).toBeNull();
    expect(marker.isSet()).toBe(false);
  });
  it("never throws when storage is unavailable or throws (private mode, quota)", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    } as unknown as Storage;
    for (const storage of [() => broken, () => undefined]) {
      const marker = createStorageSignOutMarker(storage);
      expect(() => marker.set()).not.toThrow();
      expect(() => marker.clear()).not.toThrow();
      expect(marker.isSet()).toBe(false);
    }
  });
});
