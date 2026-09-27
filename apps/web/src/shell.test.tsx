import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cssVarName, TOKEN_NAMES } from "@querymodule/tokens";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Shell } from "./shell";
import { applyThemeMode } from "./theme";

afterEach(cleanup);

// Read from disk: under vitest a "?raw" CSS import resolves to "" (css is not processed), which made this guard vacuous.
const shellCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell.css"), "utf8");

describe("UX-001 web shell", () => {
  it("renders the title heading and a main landmark", () => {
    render(<Shell />);
    expect(screen.getByRole("heading", { level: 1, name: "Query Module" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
  });
});

describe("UX-011 theme mode (spec 6.5)", () => {
  it("sets data-theme on <html> for every mode", () => {
    for (const mode of ["day", "night", "redShift"] as const) {
      applyThemeMode(mode);
      expect(document.documentElement.dataset.theme).toBe(mode);
    }
  });
  it("rejects an unknown mode", () => {
    expect(() => applyThemeMode("sepia" as never)).toThrow("unknown theme mode sepia");
  });
  it("shell.css uses token variables only: no literal colours or sizes, no fallbacks, no unknown variables", () => {
    expect(shellCss).toContain(".qm-shell__header");
    expect(shellCss).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|lab\(|lch\(|hwb\(|color\(/,
    );
    expect(shellCss).not.toMatch(/\b\d+(\.\d+)?(px|rem|em)\b/);
    expect(shellCss).not.toMatch(/var\(--[\w-]+\s*,/);
    const known = new Set(TOKEN_NAMES.map((n) => cssVarName(n)));
    for (const [, name] of shellCss.matchAll(/var\((--[\w-]+)\)/g))
      expect(known.has(name ?? ""), name).toBe(true);
  });
});
