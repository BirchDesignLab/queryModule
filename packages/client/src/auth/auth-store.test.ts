import { describe, expect, it } from "vitest";
import { createAuthStore } from "./auth-store.js";

const USER = { id: "user-0001", email: "tester@querymodule.test", role: "user" };

describe("D-A26 forced password change flag (SEC-005)", () => {
  it("starts clear, is set by the API's passwordChangeRequired and is cleared by sign-out and a new sign-in", () => {
    const store = createAuthStore();
    expect(store.getState().passwordChangeRequired).toBe(false);
    store.getState().setSignedIn(USER);
    store.getState().setPasswordChangeRequired(true);
    expect(store.getState().passwordChangeRequired).toBe(true);
    store.getState().setPasswordChangeRequired(false);
    expect(store.getState().passwordChangeRequired).toBe(false);
    store.getState().setPasswordChangeRequired(true);
    store.getState().setSignedOut();
    expect(store.getState().passwordChangeRequired).toBe(false);
    store.getState().setPasswordChangeRequired(true);
    store.getState().setSignedIn(USER);
    expect(store.getState().passwordChangeRequired).toBe(false);
  });
  it("a session user who must change the password is flagged at sign-in, before any API call (#505 T34 M1)", () => {
    const store = createAuthStore();
    store.getState().setSignedIn({ ...USER, mustChangePassword: true });
    expect(store.getState().passwordChangeRequired).toBe(true);
  });
});
