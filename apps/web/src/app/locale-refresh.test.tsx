import { createTranslator } from "@querymodule/client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { API, CLIENT_CONFIG, server } from "../test/msw-server.js";
import { testServices } from "../test/render-routes.js";
import { useLocaleRefresh } from "./locale-refresh.js";
import { ServicesProvider } from "./services-context.js";

// BW3 platform gap (#642): a label added in the builder reaches an open tab when the config
// refresh brings a new config, not only after a reload.

const NEXT = { ...CLIENT_CONFIG, configHash: "b".repeat(64) };

function setup(enabled = true) {
  const services = testServices();
  const onBundle = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={services}>{children}</ServicesProvider>
  );
  renderHook(() => useLocaleRefresh("en", enabled, onBundle), { wrapper });
  return { services, onBundle };
}

describe("useLocaleRefresh", () => {
  it("fetches the bundle again when the config changes, and hands it over with the cache updated", async () => {
    const served = { ...EN_BUNDLE, "app.title": "Query Module (updated)" };
    server.use(http.get(`${API}/api/v1/locales/en`, () => HttpResponse.json(served)));
    const { services, onBundle } = setup();
    // The first config seen is the baseline: the bundle loaded at boot already matches it.
    act(() => services.queryClient.setQueryData(["config"], CLIENT_CONFIG));
    expect(onBundle).not.toHaveBeenCalled();
    act(() => services.queryClient.setQueryData(["config"], NEXT));
    await waitFor(() => expect(onBundle).toHaveBeenCalledTimes(1));
    expect(createTranslator("en", onBundle.mock.calls[0]?.[0]).t("app.title")).toBe(
      "Query Module (updated)",
    );
    expect(services.queryClient.getQueryData(["locale", "en"])).toEqual(served);
  });

  it("does nothing for the same config, or before the app is ready", async () => {
    const { services, onBundle } = setup(false);
    act(() => services.queryClient.setQueryData(["config"], CLIENT_CONFIG));
    act(() => services.queryClient.setQueryData(["config"], NEXT));
    const same = setup();
    act(() => same.services.queryClient.setQueryData(["config"], CLIENT_CONFIG));
    act(() => same.services.queryClient.setQueryData(["config"], { ...CLIENT_CONFIG }));
    await new Promise((r) => setTimeout(r, 50));
    expect(onBundle).not.toHaveBeenCalled();
    expect(same.onBundle).not.toHaveBeenCalled();
  });

  it("keeps the strings it has when the fetch fails", async () => {
    server.use(http.get(`${API}/api/v1/locales/en`, () => new HttpResponse(null, { status: 503 })));
    const { services, onBundle } = setup();
    act(() => services.queryClient.setQueryData(["config"], CLIENT_CONFIG));
    act(() => services.queryClient.setQueryData(["config"], NEXT));
    await new Promise((r) => setTimeout(r, 50));
    expect(onBundle).not.toHaveBeenCalled();
  });
});
