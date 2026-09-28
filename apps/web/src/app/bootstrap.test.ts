import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { API, META, server } from "../test/msw-server.js";
import { testServices } from "../test/render-routes.js";
import { bootstrap } from "./bootstrap.js";

describe("NFR-001 bootstrap reads /meta and the locale bundle before login (spec 5.1, 6.7)", () => {
  it("is ready with the English translator and a supported client", async () => {
    const services = testServices();
    const state = await bootstrap(services, "0.1.0");
    expect(state.status).toBe("ready");
    expect(state.translator.t("login.title")).toBe("Sign in");
    expect(state.status === "ready" && state.clientSupported).toBe(true);
    expect(services.authStore.getState().status).toBe("signedOut");
  });
  it("flags a client below minClientVersion", async () => {
    server.use(
      http.get(`${API}/api/v1/meta`, () =>
        HttpResponse.json({ ...META, minClientVersion: "9.0.0" }),
      ),
    );
    const state = await bootstrap(testServices(), "0.1.0");
    expect(state.status === "ready" && state.clientSupported).toBe(false);
  });
  it("fails with the metaUnavailable message when /meta is down", async () => {
    server.use(http.get(`${API}/api/v1/meta`, () => new HttpResponse(null, { status: 503 })));
    const state = await bootstrap(testServices(), "0.1.0");
    expect(state.status).toBe("failed");
    expect(state.status === "failed" && state.message).toBe(
      "Service information is unavailable. Try again.",
    );
    expect(state.status === "failed" && state.translator.t("error.metaUnavailable")).toBe(
      "Service information is unavailable. Try again.",
    );
  });
  it("fails with the localeUnavailable message when /locales is down", async () => {
    server.use(http.get(`${API}/api/v1/locales/en`, () => new HttpResponse(null, { status: 503 })));
    const state = await bootstrap(testServices(), "0.1.0");
    expect(state.status).toBe("failed");
    expect(state.status === "failed" && state.message).toBe(
      "Language data is unavailable. Try again.",
    );
    expect(state.status === "failed" && state.translator.t("error.localeUnavailable")).toBe(
      "Language data is unavailable. Try again.",
    );
  });
});
