import { THEME_MODES as CORE_THEME_MODES } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { CONTRAST_PAIRS, contrastFailures, contrastRatio } from "./contrast";
import { buildCss, cssVarName } from "./css";
import { buildTheme } from "./theme";
import { COLOR_TOKENS, THEME_MODES, TOKEN_NAMES } from "./tokens";

describe("UX-011 UX-002 tokens (spec 6.5)", () => {
  it("modes match the core config schema", () => {
    expect([...THEME_MODES]).toEqual([...CORE_THEME_MODES]);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  for (const mode of ["day", "night", "redShift"] as const) {
    it(`${mode}: every declared pair meets its target`, () => {
      expect(contrastFailures(mode)).toEqual([]);
    });
  }

  it("body text pairs require 7:1, severity 4.5:1, non-text 3:1", () => {
    expect(CONTRAST_PAIRS.find((p) => p.fg === "color.text.body")?.min).toBe(7);
    expect(CONTRAST_PAIRS.find((p) => p.fg === "color.severity.critical.fg")?.min).toBe(4.5);
    expect(CONTRAST_PAIRS.find((p) => p.fg === "focus.ring")?.min).toBe(3);
  });

  it("a site override that breaks contrast is reported", () => {
    const failures = contrastFailures("day", { "color.text.body": "#bbbbbb" });
    expect(failures.map((f) => f.pair.fg)).toContain("color.text.body");
  });

  it("redShift has no blue-dominant colours", () => {
    for (const [name, values] of Object.entries(COLOR_TOKENS)) {
      const n = Number.parseInt(values.redShift.slice(1), 16);
      expect((n & 255) <= ((n >> 16) & 255), name).toBe(true);
    }
  });

  it("names every severity token the shipped site uses", () => {
    for (const s of ["critical", "warning", "info"]) {
      expect(TOKEN_NAMES).toContain(`color.severity.${s}.fg`);
      expect(TOKEN_NAMES).toContain(`color.severity.${s}.bg`);
    }
  });

  it("builds CSS variables per mode with reduced motion", () => {
    const css = buildCss();
    expect(cssVarName("color.text.body")).toBe("--qm-color-text-body");
    expect(css).toContain("--qm-color-text-body: #1a1a1a;");
    expect(css).toContain(':root[data-theme="night"] {');
    expect(css).toContain(':root[data-theme="redShift"] {');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("--qm-motion-duration-fast: 0ms;");
  });

  it("builds a typed theme object for React Native with overrides", () => {
    expect(buildTheme("night").colors["color.text.body"]).toBe("#e8e8e8");
    expect(
      buildTheme("day", { "color.surface.base": "#fafafa" }).colors["color.surface.base"],
    ).toBe("#fafafa");
    expect(buildTheme("day").scale["target.min"]).toBe("48px");
  });
});
