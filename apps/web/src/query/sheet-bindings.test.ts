import { resolveShortcuts } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { sheetBindings } from "./sheet-bindings.js";

describe("G8 the sheet lists only quick-access shortcuts that pick something", () => {
  const all = resolveShortcuts();

  it("drops quickType bindings past the number of quick-access buttons", () => {
    const shown = Object.keys(sheetBindings(all, 5));
    for (const n of [1, 2, 3, 4, 5]) expect(shown).toContain(`quickType${n}`);
    for (const n of [6, 7, 8, 9]) expect(shown).not.toContain(`quickType${n}`);
    expect(shown).toContain("submit");
  });

  it("keeps every binding of the other actions as they are", () => {
    const shown = sheetBindings(all, 5);
    expect(shown.submit).toEqual(all.submit);
    expect(shown.goPanel).toEqual(all.goPanel);
  });

  it("lists none when there are no buttons", () => {
    expect(Object.keys(sheetBindings(all, 0)).some((a) => a.startsWith("quickType"))).toBe(false);
  });
});
