import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { COLOR_TOKENS, contrastRatio, THEME_MODES } from "@querymodule/tokens";
import { describe, expect, it } from "vitest";

// node:url's URL (not the global one, which jsdom's "environment: jsdom" shadows) avoids
// failing Node fs's instanceof check on Windows (readFileSync(new URL(...)), PR #83).
const css = readFileSync(fileURLToPath(new NodeURL("./styles.css", import.meta.url)), "utf8");

describe("spec:CV1 the invalid-field border and error text meet WCAG 2.1 AA contrast in every mode (spec 6.2, 6.5, 6.6)", () => {
  it("styles.css uses field.required, not the severity-critical badge background, for these two usages", () => {
    // color.severity.critical.bg is a badge background: night's #8b0000 fails 3:1/4.5:1 against
    // this file's own surfaces. field.required is the token the design system marks
    // foreground-safe (day #a00000, night #ff8080, redShift #ff4d4d).
    expect(css).toMatch(
      /\.qm-field__input\[aria-invalid="true"\]\s*\{[^}]*var\(--qm-field-required\)/,
    );
    expect(css).not.toMatch(
      /\.qm-field__input\[aria-invalid="true"\]\s*\{[^}]*var\(--qm-color-severity-critical-bg\)/,
    );
    expect(css).toMatch(
      /\.qm-field__error,\s*\n\.qm-form-error\s*\{[^}]*var\(--qm-field-required\)/,
    );
    expect(css).not.toMatch(
      /\.qm-field__error,\s*\n\.qm-form-error\s*\{[^}]*var\(--qm-color-severity-critical-bg\)/,
    );
  });

  it("field.required as a non-text border against surface.raised is at least 3:1 in every mode", () => {
    for (const mode of THEME_MODES) {
      const ratio = contrastRatio(
        COLOR_TOKENS["field.required"][mode],
        COLOR_TOKENS["color.surface.raised"][mode],
      );
      expect(ratio).toBeGreaterThanOrEqual(3);
    }
  });

  it("field.required as error text against surface.base is at least 4.5:1 in every mode", () => {
    for (const mode of THEME_MODES) {
      const ratio = contrastRatio(
        COLOR_TOKENS["field.required"][mode],
        COLOR_TOKENS["color.surface.base"][mode],
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("#395 critic 6: a selected tab is visually distinct from an unselected one (UX-004, WCAG 1.4.1, 1.4.11)", () => {
  it("an unselected tab is outlined: surface fill, accent text, the button's accent border", () => {
    expect(css).toMatch(
      /\.qm-button\[role="tab"\]\[aria-selected="false"\]\s*\{[^}]*background:\s*var\(--qm-color-surface-base\);[^}]*color:\s*var\(--qm-color-accent\);/,
    );
    expect(css).toMatch(/\.qm-button\s*\{[^}]*border:[^;]*var\(--qm-color-accent\);/);
  });

  it("both tab states meet 4.5:1 in every mode", () => {
    // Contrast is symmetric, so one pair covers both states (surface text on the accent fill, accent
    // text on the surface) and the fill-versus-outline cue and border against the page (3:1 needed).
    for (const mode of THEME_MODES) {
      const ratio = contrastRatio(
        COLOR_TOKENS["color.surface.base"][mode],
        COLOR_TOKENS["color.accent"][mode],
      );
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});
