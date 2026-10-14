import { describe, expect, it } from "vitest";
import { tokensContrast } from "./contrast-context";

describe("tokensContrast", () => {
  it("looks up a token value, an override first, and skips non-colour values", () => {
    expect(tokensContrast.value("color.surface.base", "day", {})).toMatch(/^#[0-9a-f]{6}$/i);
    expect(
      tokensContrast.value("color.surface.base", "day", { "color.surface.base": "#112233" }),
    ).toBe("#112233");
    expect(
      tokensContrast.value("color.surface.base", "day", { "color.surface.base": "red" }),
    ).toBeUndefined();
    expect(tokensContrast.value("not-a-token", "day", {})).toBeUndefined();
  });

  it("ratio is the WCAG contrast ratio", () => {
    expect(tokensContrast.ratio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("failures ignores an override that is not #rrggbb instead of throwing", () => {
    expect(() => tokensContrast.failures("day", { "color.surface.base": "red" })).not.toThrow();
    const bad = tokensContrast.failures("day", {
      "color.surface.base": "#ffffff",
      "color.text.body": "#fefefe",
    });
    expect(bad.length).toBeGreaterThan(0);
    expect(Object.keys(bad[0] ?? {}).sort()).toEqual(["bg", "fg", "min", "ratio"]);
  });
});
