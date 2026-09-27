import {
  COLOR_TOKENS,
  type ColorTokenName,
  contrastFailures,
  contrastRatio,
  THEME_MODES,
  tokenValue,
} from "@querymodule/tokens";
import { describe, expect, it } from "vitest";

describe("UX-002 contrast per theme mode (spec 2, 6.5)", () => {
  it.each(THEME_MODES)("%s meets every declared pair target", (mode) => {
    expect(contrastFailures(mode)).toEqual([]);
  });
  it.each(THEME_MODES)(
    "%s body text is at least 7:1 on both surfaces (mobile unit, every mode)",
    (mode) => {
      const body = tokenValue("color.text.body", mode);
      expect(contrastRatio(body, tokenValue("color.surface.base", mode))).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(body, tokenValue("color.surface.raised", mode))).toBeGreaterThanOrEqual(
        7,
      );
    },
  );
});

describe("UX-002 red-shift mode has no blue-dominant colours", () => {
  it.each(Object.keys(COLOR_TOKENS) as ColorTokenName[])("%s keeps blue below red", (token) => {
    const n = Number.parseInt(tokenValue(token, "redShift").slice(1), 16);
    expect(n & 255).toBeLessThan((n >> 16) & 255);
  });
});
