import { describe, expect, it, vi } from "vitest";
import type { AuthApi, SessionUser } from "../auth/auth-api.js";
import { createAuthStore } from "../auth/auth-store.js";
import { createQueryClient, registerQueryCacheReset } from "../query/query-client.js";
import { createResetController } from "./reset.js";
import { createSessionController, type SignOutMarker } from "./session-controller.js";

const A: SessionUser = { id: "user-a", email: "a@querymodule.test", role: "user" };
const B: SessionUser = { id: "user-b", email: "b@querymodule.test", role: "user" };

function memoryMarker(initial = false): SignOutMarker & { value: boolean } {
  const m = {
    value: initial,
    isSet: () => m.value,
    set: () => {
      m.value = true;
    },
    clear: () => {
      m.value = false;
    },
  };
  return m;
}

function setup(api: Partial<AuthApi> = {}, signOutMarker = memoryMarker()) {
  const authApi: AuthApi = {
    signInEmail: async () => ({ ok: true, user: A }),
    signOut: vi.fn(async () => undefined),
    getSession: async () => null,
    changePassword: async () => ({ ok: true }),
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
    signOutMarker,
    session: createSessionController({ authApi, authStore, reset, signOutMarker }),
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
  it("SEC-006: a failed server sign-out still wipes local state, flags it and rethrows", async () => {
    const t = setup({
      signOut: vi.fn(async () => {
        throw new Error("sign-out failed: 503");
      }),
    });
    await t.session.signIn("a@querymodule.test", "x");
    await expect(t.session.signOut()).rejects.toThrow(/503/);
    expect(t.spy).toHaveBeenCalledTimes(1);
    expect(t.authStore.getState()).toMatchObject({
      status: "signedOut",
      user: null,
      signOutFailed: true,
    });
  });
  it("SEC-006: the signOutFailed flag survives a reset that throws during the wipe", async () => {
    const t = setup({
      signOut: vi.fn(async () => {
        throw new Error("sign-out failed: 503");
      }),
    });
    await t.session.signIn("a@querymodule.test", "x");
    t.reset.register(() => {
      throw new Error("a store failed to reset");
    });
    await expect(t.session.signOut()).rejects.toThrow();
    expect(t.authStore.getState()).toMatchObject({ status: "signedOut", signOutFailed: true });
  });
  it("a successful sign-out leaves signOutFailed false", async () => {
    const t = setup();
    await t.session.signIn("a@querymodule.test", "x");
    await t.session.signOut();
    expect(t.authStore.getState().signOutFailed).toBe(false);
  });
  it("retrySignOut keeps the flag while the server still fails and clears it on success", async () => {
    let fail = true;
    const signOut = vi.fn(async () => {
      if (fail) throw new Error("sign-out failed: network");
    });
    const t = setup({ signOut });
    await t.session.signIn("a@querymodule.test", "x");
    await expect(t.session.signOut()).rejects.toThrow();
    await expect(t.session.retrySignOut()).rejects.toThrow();
    expect(t.authStore.getState().signOutFailed).toBe(true);
    fail = false;
    await t.session.retrySignOut();
    expect(t.authStore.getState().signOutFailed).toBe(false);
    expect(signOut).toHaveBeenCalledTimes(3);
  });
  it("a new sign-in clears a stale signOutFailed", async () => {
    const t = setup({
      signOut: vi.fn(async () => {
        throw new Error("sign-out failed: network");
      }),
    });
    await t.session.signIn("a@querymodule.test", "x");
    await expect(t.session.signOut()).rejects.toThrow();
    await t.session.signIn("a@querymodule.test", "x");
    expect(t.authStore.getState().signOutFailed).toBe(false);
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
  it("a throwing reset still leaves the auth state updated (fail-safe, spec 6.7)", async () => {
    const t = setup();
    t.reset.register(() => {
      throw new Error("boom");
    });
    await t.session.signIn("a@querymodule.test", "x");
    await expect(t.session.signOut()).rejects.toThrow(AggregateError);
    expect(t.authStore.getState()).toMatchObject({ status: "signedOut", user: null });
  });
  it("drops a stale bootstrap result that resolves after a newer sign-in (spec 6.7)", async () => {
    let resolveDeferred!: (user: SessionUser | null) => void;
    const deferred = new Promise<SessionUser | null>((resolve) => {
      resolveDeferred = resolve;
    });
    const t = setup({
      getSession: () => deferred,
      signInEmail: async () => ({ ok: true, user: B }),
    });
    const bootstrapPromise = t.session.bootstrap();
    await t.session.signIn("b@querymodule.test", "x");
    resolveDeferred(A);
    await bootstrapPromise;
    expect(t.authStore.getState()).toMatchObject({ status: "signedIn", user: B });
    expect(t.spy).not.toHaveBeenCalled();
  });
  it("the registered query cache is cancelled and cleared on sign-out, a 401 and a user change (SEC-006, spec 6.7)", async () => {
    const t = setup();
    const client = createQueryClient();
    const cancelSpy = vi.spyOn(client, "cancelQueries");
    registerQueryCacheReset(t.reset, client);

    await t.session.signIn("a@querymodule.test", "x");
    client.setQueryData(["probe"], 1);
    await t.session.signOut();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["probe"])).toBeUndefined();

    await t.session.signIn("a@querymodule.test", "x");
    client.setQueryData(["probe"], 1);
    t.session.handleUnauthenticated();
    expect(cancelSpy).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(["probe"])).toBeUndefined();

    const t2 = setup({ getSession: async () => B });
    registerQueryCacheReset(t2.reset, client);
    await t2.session.signIn("a@querymodule.test", "x");
    client.setQueryData(["probe"], 1);
    await t2.session.bootstrap();
    expect(client.getQueryData(["probe"])).toBeUndefined();
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

describe("SEC-006 a pending server sign-out survives a reload (#241)", () => {
  const failing = () =>
    vi.fn(async () => {
      throw new Error("sign-out failed: 503");
    });

  it("a failed sign-out sets the marker; a successful one clears it", async () => {
    const t = setup({ signOut: failing() });
    await t.session.signIn("a@querymodule.test", "x");
    await expect(t.session.signOut()).rejects.toThrow();
    expect(t.signOutMarker.value).toBe(true);
    const ok = setup({}, memoryMarker(true));
    await ok.session.signIn("a@querymodule.test", "x");
    await ok.session.signOut();
    expect(ok.signOutMarker.value).toBe(false);
  });

  it("boot with the marker retries sign-out first; on failure it never adopts the old session", async () => {
    const getSession = vi.fn(async () => A);
    const t = setup({ signOut: failing(), getSession }, memoryMarker(true));
    await t.session.bootstrap();
    expect(getSession).not.toHaveBeenCalled();
    expect(t.authStore.getState()).toMatchObject({
      status: "signedOut",
      user: null,
      signOutFailed: true,
    });
    expect(t.signOutMarker.value).toBe(true);
  });

  it("boot with the marker: a retry that succeeds clears it, then boots normally", async () => {
    const calls: string[] = [];
    const t = setup(
      {
        signOut: vi.fn(async () => {
          calls.push("signOut");
        }),
        getSession: async () => {
          calls.push("getSession");
          return null;
        },
      },
      memoryMarker(true),
    );
    await t.session.bootstrap();
    expect(calls).toEqual(["signOut", "getSession"]);
    expect(t.signOutMarker.value).toBe(false);
    expect(t.authStore.getState()).toMatchObject({ status: "signedOut", signOutFailed: false });
  });

  it("a successful retrySignOut clears the marker", async () => {
    let fail = true;
    const t = setup({
      signOut: vi.fn(async () => {
        if (fail) throw new Error("sign-out failed: network");
      }),
    });
    await t.session.signIn("a@querymodule.test", "x");
    await expect(t.session.signOut()).rejects.toThrow();
    fail = false;
    expect(await t.session.retrySignOut()).toBe(true);
    expect(t.signOutMarker.value).toBe(false);
  });

  it("W4: a sign-in during a slow retry aborts it and the late result is ignored", async () => {
    let signal: AbortSignal | undefined;
    let settle: (() => void) | undefined;
    let first = true;
    const signOut = vi.fn(async (o?: { signal?: AbortSignal }) => {
      if (first) {
        first = false;
        throw new Error("sign-out failed: 503");
      }
      signal = o?.signal;
      await new Promise<void>((r) => {
        settle = r;
      });
    });
    const t = setup({ signOut, signInEmail: async () => ({ ok: true, user: B }) });
    await t.session.signIn("a@querymodule.test", "x");
    await expect(t.session.signOut()).rejects.toThrow();
    const retry = t.session.retrySignOut();
    await t.session.signIn("b@querymodule.test", "x");
    expect(signal?.aborted).toBe(true);
    settle?.();
    expect(await retry).toBe(false);
    expect(t.authStore.getState()).toMatchObject({
      status: "signedIn",
      user: B,
      signOutFailed: false,
    });
    expect(t.signOutMarker.value).toBe(false);
  });
});
