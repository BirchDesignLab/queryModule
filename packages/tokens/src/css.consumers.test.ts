import { buildCss, buildTheme, cssVarName } from "@querymodule/tokens";
import { describe, expect, it } from "vitest";

describe("BR-001 CSS custom properties this plan's UI depends on (spec 6.5)", () => {
  it("names variables with the qm- prefix", () => {
    expect(cssVarName("color.text.body")).toBe("--qm-color-text-body");
  });
  it("emits day on bare :root and night/redShift keyed by data-theme, using the qm- prefix", () => {
    const css = buildCss();
    expect(css).toContain(":root {");
    expect(css).toContain(':root[data-theme="night"] {');
    expect(css).toContain(':root[data-theme="redShift"] {');
    expect(css).not.toContain(':root[data-theme="day"] {');
    expect(css).toMatch(/--qm-color-surface-base:/);
  });
});

describe("BR-001 native theme object this plan's M4 rn-ui consumer depends on (spec 6.5)", () => {
  it("returns a mode, colours and scale", () => {
    const theme = buildTheme("night");
    expect(theme.mode).toBe("night");
    expect(theme.colors["color.surface.base" as never]).toBeDefined();
  });
});
