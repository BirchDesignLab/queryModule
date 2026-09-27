import { describe, expect, it, vi } from "vitest";
import type { AuthApi, SessionUser } from "../auth/auth-api.js";
import { createAuthStore } from "../auth/auth-store.js";
import { createResetController } from "./reset.js";
import { createSessionController } from "./session-controller.js";

const A: SessionUser = { id: "user-a", email: "a@querymodule.test", role: "user" };
const B: SessionUser = { id: "user-b", email: "b@querymodule.test", role: "user" };

function setup(api: Partial<AuthApi> = {}) {
  const authApi: AuthApi = {
    signInEmail: async () => ({ ok: true, user: A }),
    signOut: vi.fn(async () => undefined),
    getSession: async () => null,
    ...api,
  };
  const authStore = createAuthStore();
  const reset = createResetController();
  const spy = vi.fn();
  reset.register(spy);
  return {
    authApi,
    authStore,
    reset,
    spy,
    session: createSessionController({ authApi, authStore, reset }),
  };
}

describe("SEC-006 client state resets on logout, 401 and user change (spec 6.7)", () => {
  it("bootstrap adopts an existing session", async () => {
    const t = setup({ getSession: async () => A });
    await t.session.bootstrap();
    expect(t.authStore.getState()).toMatchObject({ status: "signedIn", user: A });
    expect(t.spy).not.toHaveBeenCalled();
  });
  it("bootstrap with no session is signedOut", async () => {
    const t = setup();
    await t.session.bootstrap();
    expect(t.authStore.getState().status).toBe("signedOut");
  });
  it("a failed sign-in leaves the user signed out and returns the result", async () => {
    const t = setup({
      signInEmail: async () => ({ ok: false, code: "unauthenticated", retryAfterSeconds: null }),
    });
    expect(await t.session.signIn("a@querymodule.test", "x")).toMatchObject({ ok: false });
    expect(t.authStore.getState().status).toBe("unknown");
  });
  it("sign-out calls the API, resets once and signs out", async () => {
    const t = setup();
    await t.session.signIn("a@querymodule.test", "x");
    await t.session.signOut();
    expect(t.authApi.signOut).toHaveBeenCalledTimes(1);
    expect(t.spy).toHaveBeenCalledTimes(1);
    expect(t.authStore.getState()).toMatchObject({ status: "signedOut", user: null });
  });
  it("a 401 while signed in resets and signs out; while signed out it does nothing", async () => {
    const t = setup();
    t.session.handleUnauthenticated();
    expect(t.spy).not.toHaveBeenCalled();
    await t.session.signIn("a@querymodule.test", "x");
    t.session.handleUnauthenticated();
    expect(t.spy).toHaveBeenCalledTimes(1);
    expect(t.authStore.getState().status).toBe("signedOut");
  });
  it("a different user id resets before adopting the new user", async () => {
    const t = setup({ getSession: async () => B });
    await t.session.signIn("a@querymodule.test", "x");
    await t.session.bootstrap();
    expect(t.spy).toHaveBeenCalledTimes(1);
    expect(t.authStore.getState().user).toEqual(B);
  });
  it("unregistered reset functions are not called", () => {
    const reset = createResetController();
    const fn = vi.fn();
    const off = reset.register(fn);
    off();
    reset.resetAll();
    expect(fn).not.toHaveBeenCalled();
  });
});
