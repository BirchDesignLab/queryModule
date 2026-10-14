import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced.js";

// BW3 polish (#642, CRITIC-M3): the announcement settles after typing pauses, not per keystroke.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebouncedValue", () => {
  it("keeps the initial value until the value has been still for the delay", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 600, true, ""),
      { initialProps: { value: "a" } },
    );
    expect(result.current).toBe("");
    act(() => void vi.advanceTimersByTime(599));
    expect(result.current).toBe("");
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe("a");
    rerender({ value: "b" });
    expect(result.current).toBe("a");
  });

  it("restarts the wait on every change, so a burst of changes settles once on the last", () => {
    const seen: string[] = [];
    const { result, rerender } = renderHook(
      ({ value }) => {
        const out = useDebouncedValue(value, 600, true, "");
        if (seen.at(-1) !== out) seen.push(out);
        return out;
      },
      { initialProps: { value: "a" } },
    );
    for (const value of ["b", "c", "d"]) {
      act(() => void vi.advanceTimersByTime(300));
      rerender({ value });
    }
    expect(result.current).toBe("");
    act(() => void vi.advanceTimersByTime(600));
    expect(result.current).toBe("d");
    expect(seen).toEqual(["", "d"]);
  });

  it("says nothing while disabled", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 600, false, ""));
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current).toBe("");
  });
});
