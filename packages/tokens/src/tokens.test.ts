import { THEME_MODES as CORE_THEME_MODES } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { CONTRAST_PAIRS, contrastFailures, contrastRatio, relativeLuminance } from "./contrast";
import { buildCss, cssVarName } from "./css";
import { buildTheme } from "./theme";
import { COLOR_TOKENS, THEME_MODES, TOKEN_NAMES, tokenValue } from "./tokens";

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

  it("declares every pair with its target: text 7:1, severity 4.5:1, non-text 3:1", () => {
    expect(CONTRAST_PAIRS.map((p) => [p.fg, p.bg, p.min])).toEqual([
      ["color.text.body", "color.surface.base", 7],
      ["color.text.body", "color.surface.raised", 7],
      ["color.accent", "color.surface.base", 7],
      ["color.accent", "color.surface.raised", 7],
      ["color.severity.critical.fg", "color.severity.critical.bg", 4.5],
      ["color.severity.warning.fg", "color.severity.warning.bg", 4.5],
      ["color.severity.info.fg", "color.severity.info.bg", 4.5],
      ["field.required", "color.surface.base", 3],
      ["focus.ring", "color.surface.base", 3],
      ["color.border", "color.surface.base", 3],
    ]);
  });

  it("rejects a colour that is not #rrggbb", () => {
    expect(() => relativeLuminance("#abc")).toThrow("not a #rrggbb colour: #abc");
  });

  it("tokenValue reads colour tokens per mode and scale tokens in any mode", () => {
    expect(tokenValue("color.accent", "night")).toBe(COLOR_TOKENS["color.accent"].night);
    expect(tokenValue("focus.ring.width", "redShift")).toBe("3px");
    expect(tokenValue("focus.ring.offset", "day")).toBe("2px");
    expect(tokenValue("border.width", "day")).toBe("1px");
  });

  it("required marker is classified as non-text UI at 3:1 (spec 6.5)", () => {
    const pair = CONTRAST_PAIRS.find((p) => p.fg === "field.required");
    expect(pair?.min).toBe(3);
    expect(pair?.use).not.toMatch(/marker text/);
  });

  it("a site override that breaks contrast is reported", () => {
    const failures = contrastFailures("day", { "color.text.body": "#bbbbbb" });
    expect(failures.map((f) => f.pair.fg)).toContain("color.text.body");
  });

  it("redShift keeps blue strictly below red in every colour", () => {
    for (const [name, values] of Object.entries(COLOR_TOKENS)) {
      const n = Number.parseInt(values.redShift.slice(1), 16);
      expect((n & 255) < ((n >> 16) & 255), name).toBe(true);
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
