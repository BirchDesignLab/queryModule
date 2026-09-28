import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { installMatchMedia } from "../test/match-media.js";
import { usePersona } from "./usePersona.js";

describe("UX-001 persona from pointer, never width (spec 6.1)", () => {
  it("coarse pointer gives mobileUnit and follows pointer changes", () => {
    const media = installMatchMedia({ "(any-pointer: coarse)": true });
    const { result } = renderHook(() => usePersona(null, null));
    expect(result.current.persona).toBe("mobileUnit");
    act(() => media.set("(any-pointer: coarse)", false));
    expect(result.current.persona).toBe("dispatch");
  });
  it("an override is not re-evaluated on pointer change", () => {
    const media = installMatchMedia({ "(any-pointer: coarse)": false });
    const { result } = renderHook(() => usePersona(null, "records"));
    act(() => media.set("(any-pointer: coarse)", true));
    expect(result.current).toEqual({
      persona: "records",
      source: "override",
      reevaluateOnPointerChange: false,
    });
  });
  it("UX-012 queries no width media feature", () => {
    const media = installMatchMedia();
    renderHook(() => usePersona(null, null));
    expect(media.queries.every((q) => !q.includes("width"))).toBe(true);
  });
});
