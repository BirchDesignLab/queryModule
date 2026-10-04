import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { testServices } from "../test/render-routes.js";
import { useCachedConfigState } from "./cached-config.js";
import { ServicesProvider } from "./services-context.js";

// #480 (#442, Task 32): the status page and the admin builder preview read the live config the
// same way, through this one hook.
function setup() {
  const services = testServices();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={services}>{children}</ServicesProvider>
  );
  const view = renderHook(() => useCachedConfigState(), { wrapper });
  const fail = () =>
    act(async () => {
      await services.queryClient
        .fetchQuery({
          queryKey: ["config"],
          queryFn: () => Promise.reject(new Error("unavailable")),
          retry: false,
          staleTime: 0,
        })
        .catch(() => undefined);
    });
  return { services, view, fail };
}

describe("one hook for the cached GET /api/v1/config (#480)", () => {
  it("is nothing and not unavailable before any fetch", () => {
    const { view } = setup();
    expect(view.result.current).toEqual({ config: undefined, unavailable: false });
  });

  it("follows the cache: the config appears when a fetch (or the refresh) writes it", () => {
    const { services, view } = setup();
    act(() => services.queryClient.setQueryData(["config"], CLIENT_CONFIG));
    expect(view.result.current).toEqual({ config: CLIENT_CONFIG, unavailable: false });
  });

  it("is unavailable when the fetch failed and left no data", async () => {
    const { view, fail } = setup();
    await fail();
    expect(view.result.current).toEqual({ config: undefined, unavailable: true });
  });

  it("is not unavailable while a config is in hand, even if a later refetch failed", async () => {
    const { services, view, fail } = setup();
    act(() => services.queryClient.setQueryData(["config"], CLIENT_CONFIG));
    await fail();
    expect(services.queryClient.getQueryState(["config"])?.status).toBe("error");
    expect(view.result.current).toEqual({ config: CLIENT_CONFIG, unavailable: false });
  });
});
