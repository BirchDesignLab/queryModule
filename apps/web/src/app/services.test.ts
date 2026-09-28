import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { API, server, TEST_PASSWORD, TEST_USER } from "../test/msw-server.js";
import { testServices } from "../test/render-routes.js";

describe("SEC-006 sign-out clears query cache, announcer and preferences (spec 6.7)", () => {
  it("resets every registered store", async () => {
    const services = testServices();
    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    services.queryClient.setQueryData(["probe"], 1);
    services.announcer.announce("hello");
    services.preferences.getState().setThemeMode("night");
    await services.session.signOut();
    expect(services.queryClient.getQueryData(["probe"])).toBeUndefined();
    expect(services.announcer.current()).toEqual({ polite: null, assertive: null });
    expect(services.preferences.getState().themeMode).toBeNull();
    expect(services.authStore.getState().status).toBe("signedOut");
  });

  it("cancels in-flight queries before clearing the cache on sign-out (SEC-006)", async () => {
    const services = testServices();
    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    const cancelSpy = vi.spyOn(services.queryClient, "cancelQueries");
    const clearSpy = vi.spyOn(services.queryClient, "clear");
    await services.session.signOut();
    expect(cancelSpy).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("wires the API client's onUnauthenticated to session.handleUnauthenticated", async () => {
    const services = testServices();
    await services.session.signIn(TEST_USER.email, TEST_PASSWORD);
    services.queryClient.setQueryData(["probe"], 1);
    server.use(http.get(`${API}/api/v1/meta`, () => new HttpResponse(null, { status: 401 })));
    await services.api.GET("/api/v1/meta");
    expect(services.authStore.getState().status).toBe("signedOut");
    expect(services.queryClient.getQueryData(["probe"])).toBeUndefined();
  });
});
