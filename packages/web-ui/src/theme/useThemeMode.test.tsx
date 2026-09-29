import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMatchMedia } from "../test/match-media.js";
import { useThemeMode } from "./useThemeMode.js";

describe("UX-002 theme mode applied to <html> without reload (spec 6.5)", () => {
  it("follows the OS scheme before site config and when it changes", () => {
    const media = installMatchMedia({ "(prefers-color-scheme: dark)": true });
    const { result } = renderHook(() => useThemeMode({ preference: null, selection: null }));
    expect(result.current).toBe("night");
    expect(document.documentElement.dataset.theme).toBe("night");
    act(() => media.set("(prefers-color-scheme: dark)", false));
    expect(document.documentElement.dataset.theme).toBe("day");
  });
  it("an explicit preference wins", () => {
    installMatchMedia({ "(prefers-color-scheme: dark)": true });
    const { result } = renderHook(() => useThemeMode({ preference: "redShift", selection: null }));
    expect(result.current).toBe("redShift");
    expect(document.documentElement.dataset.theme).toBe("redShift");
  });
});

describe("UX-002 site default auto follows the clock (D-B1, #175)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("tracks the hour with no preference when the site defaults to auto time", () => {
    installMatchMedia({});
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 18, 59));
    const { result } = renderHook(() =>
      useThemeMode({ preference: null, selection: { defaultMode: "auto", auto: "time" } }),
    );
    expect(result.current).toBe("day");
    act(() => {
      vi.setSystemTime(new Date(2026, 8, 28, 19, 0));
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe("night");
    expect(document.documentElement.dataset.theme).toBe("night");
  });
});
