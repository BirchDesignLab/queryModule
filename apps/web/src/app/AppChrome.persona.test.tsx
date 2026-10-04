import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, onTestFinished } from "vitest";
import { testServices } from "../test/render-routes.js";
import { useResolvedPersona } from "./AppChrome.js";
import { ServicesProvider } from "./services-context.js";

// #382 W-18 (spec 6.1): one hook resolves the signed-in persona, so AppChrome (the data-persona
// attribute) and usePersonaLayout (the layout) cannot disagree.
function resolve(override: string | null): string {
  const services = testServices();
  services.preferences.getState().setPersonaOverride(override);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider services={services}>{children}</ServicesProvider>
  );
  return renderHook(() => useResolvedPersona(), { wrapper }).result.current;
}

describe("spec 6.1 the resolved persona", () => {
  it("is the stored override when there is one", () => {
    expect(resolve("records")).toBe("records");
  });

  it("is dispatch on a mouse device with no override", () => {
    expect(resolve(null)).toBe("dispatch");
  });

  it("is mobileUnit on a coarse-pointer device with no override, and the override still wins", () => {
    const original = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        matches: query === "(any-pointer: coarse)",
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList;
    onTestFinished(() => {
      window.matchMedia = original;
    });
    expect(resolve(null)).toBe("mobileUnit");
    expect(resolve("records")).toBe("records");
  });
});
