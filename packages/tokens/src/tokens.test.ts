import { THEME_MODES as CORE_THEME_MODES } from "@querymodule/core/config";
import { describe, expect, it } from "vitest";
import { CONTRAST_PAIRS, contrastFailures, contrastRatio, relativeLuminance } from "./contrast";
import { buildCss, cssVarName } from "./css";
import { buildTheme } from "./theme";
import { COLOR_TOKENS, LAYOUT_CONSTANTS, THEME_MODES, TOKEN_NAMES, tokenValue } from "./tokens";

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

  it("declares the design-system pairs (docs/design/2026-09-29-visual-system.md), each mode checked above", () => {
    const SURFACES = [
      "color.surface.sunken",
      "color.surface.base",
      "color.surface.raised",
      "color.surface.overlay",
    ] as const;
    const has = (fg: string, bg: string, min: number) =>
      expect(
        CONTRAST_PAIRS.some((p) => p.fg === fg && p.bg === bg && p.min === min),
        `${fg} on ${bg} at ${min}`,
      ).toBe(true);
    for (const bg of SURFACES) {
      has("color.text.body", bg, 7);
      has("color.text.muted", bg, 4.5);
      has("color.border", bg, 3);
      has("focus.ring", bg, 3);
    }
    has("color.text.body", "color.accent.subtle", 7);
    has("color.accent", "color.accent.subtle", 4.5);
    has("color.text.muted", "color.accent.subtle", 4.5);
    has("color.accent.onFill", "color.accent.fill", 4.5);
    has("field.required", "color.accent.subtle", 4.5); // danger button on hover
    for (const bg of ["color.surface.base", "color.surface.raised"] as const) {
      has("color.accent", bg, 7);
      has("field.required", bg, 4.5);
      has("color.status.ok", bg, 4.5);
    }
  });

  it("E1: the focus ring never shares a colour with the invalid edge in any mode", () => {
    for (const mode of THEME_MODES)
      expect(tokenValue("focus.ring", mode), mode).not.toBe(tokenValue("field.required", mode));
  });

  it("design system values: night surfaces step up, red shift ring is pale amber, amber night ring", () => {
    expect(COLOR_TOKENS["color.surface.sunken"].night).toBe("#0a0e13");
    expect(COLOR_TOKENS["color.surface.base"].night).toBe("#10151c");
    expect(COLOR_TOKENS["color.surface.overlay"].night).toBe("#1e2733");
    expect(COLOR_TOKENS["focus.ring"].night).toBe("#ffd24d");
    expect(COLOR_TOKENS["focus.ring"].redShift).toBe("#ffe0a8");
    expect(COLOR_TOKENS["color.accent.fill"].night).toBe(COLOR_TOKENS["color.accent"].night);
  });

  it("the type, space, radius and density scale (px 12 13 14 16 20 24 32; dense 36, touch 56)", () => {
    const px = (n: Parameters<typeof tokenValue>[0]) => tokenValue(n, "day");
    expect(
      (["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const).map((k) => px(`type.size.${k}`)),
    ).toEqual(["12px", "13px", "14px", "16px", "20px", "24px", "32px"]);
    expect([px("space.5"), px("space.8"), px("space.12")]).toEqual(["20px", "32px", "48px"]);
    expect([px("radius.control"), px("radius.panel")]).toEqual(["6px", "10px"]);
    expect([px("control.height.dense"), px("control.height.touch")]).toEqual(["36px", "56px"]);
    expect(px("focus.ring.width")).toBe("2px");
    for (const name of ["type.family", "type.family.label", "type.family.data"] as const) {
      expect(px(name), name).toMatch(/IBM Plex/);
      // A system fallback ends every stack, so a missing font file never leaves the UI unstyled.
      expect(px(name), name).toMatch(/(sans-serif|monospace)$/);
    }
  });

  it("declares every pair with its target: text 7:1, severity 4.5:1, non-text 3:1", () => {
    expect(CONTRAST_PAIRS.slice(0, 10).map((p) => [p.fg, p.bg, p.min])).toEqual([
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
    expect(tokenValue("focus.ring.width", "redShift")).toBe("2px");
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
    expect(css).toContain("--qm-color-text-body: #121820;");
    expect(css).toContain(':root[data-theme="night"] {');
    expect(css).toContain(':root[data-theme="redShift"] {');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("--qm-motion-duration-fast: 0ms;");
  });

  it("builds a typed theme object for React Native with overrides", () => {
    expect(buildTheme("night").colors["color.text.body"]).toBe("#e7ecf2");
    expect(
      buildTheme("day", { "color.surface.base": "#fafafa" }).colors["color.surface.base"],
    ).toBe("#fafafa");
    expect(buildTheme("day").scale["target.min"]).toBe("48px");
  });
});

describe("inert opacity, scrim and layout constant (cloud3 item 1)", () => {
  it("opacity.inert is one scale token, ~0.55, in TOKEN_NAMES and the generated CSS", () => {
    expect(TOKEN_NAMES).toContain("opacity.inert");
    for (const mode of THEME_MODES) expect(tokenValue("opacity.inert", mode)).toBe("0.55");
    expect(buildCss()).toContain("--qm-opacity-inert: 0.55;");
  });

  it("surface.scrim is a #rrggbb colour per mode; night and red shift keep the sunken surface", () => {
    expect(TOKEN_NAMES).toContain("color.surface.scrim");
    for (const mode of THEME_MODES)
      expect(COLOR_TOKENS["color.surface.scrim"][mode], mode).toMatch(/^#[0-9a-f]{6}$/);
    expect(COLOR_TOKENS["color.surface.scrim"].night).toBe(
      COLOR_TOKENS["color.surface.sunken"].night,
    );
    expect(COLOR_TOKENS["color.surface.scrim"].redShift).toBe(
      COLOR_TOKENS["color.surface.sunken"].redShift,
    );
    // Day: a dark scrim, unlike the light sunken surface, so the page visibly dims.
    expect(relativeLuminance(COLOR_TOKENS["color.surface.scrim"].day)).toBeLessThan(0.05);
  });

  it("the wide breakpoint is a fixed layout constant: emitted once on :root, never a token", () => {
    expect(LAYOUT_CONSTANTS["layout.wide"]).toBe("64rem");
    expect(TOKEN_NAMES as readonly string[]).not.toContain("layout.wide");
    const css = buildCss();
    expect(css.match(/--qm-layout-wide:/g)).toHaveLength(1);
    expect(css).toContain("--qm-layout-wide: 64rem;");
    // Not repeated under a theme block, so a theme cannot move it.
    const themed = css.slice(css.indexOf(':root[data-theme="night"]'));
    expect(themed).not.toContain("layout-wide");
  });
});
