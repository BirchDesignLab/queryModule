import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cssVarName, TOKEN_NAMES } from "@querymodule/tokens";
import { describe, expect, it } from "vitest";

// Read from disk (T20/IC1 precedent): jsdom's global URL breaks readFileSync(new URL(...)),
// and a "?raw" CSS import resolves to "" under vitest, which would make this guard vacuous.
const shellCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell.css"), "utf8");

describe("shell.css uses token variables only (spec 6.5)", () => {
  it("has no literal colours or sizes, no var() fallbacks, only known token names", () => {
    expect(shellCss).toContain("body");
    expect(shellCss).toContain(":focus-visible");
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
