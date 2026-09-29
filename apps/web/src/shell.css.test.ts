import { readdirSync, readFileSync } from "node:fs";
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

describe("D0.2 self-hosted IBM Plex (OFL, design system)", () => {
  const fontDir = join(dirname(fileURLToPath(import.meta.url)), "fonts");
  const files = readdirSync(fontDir).filter((f) => f.endsWith(".woff2"));
  const faces = [...shellCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");

  it("declares one @font-face per shipped file, each src bundled from ./fonts/ (served under /assets/)", () => {
    expect(files).toHaveLength(7);
    expect(faces).toHaveLength(files.length);
    const srcs = faces.map(
      (f) => /url\("\.\/fonts\/([^"]+\.woff2)"\)\s*format\("woff2"\)/.exec(f)?.[1],
    );
    expect([...srcs].sort()).toEqual([...files].sort());
  });

  it("loads with font-display swap, so text shows in the fallback while a file loads", () => {
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) expect(face).toMatch(/font-display:\s*swap/);
  });

  it("covers the faces the design uses: Sans 400 500 600 and 400 italic, Condensed 600, Mono 400 500", () => {
    const has = (family: string, weight: number) =>
      faces.some(
        (f) => f.includes(`font-family: "${family}"`) && f.includes(`font-weight: ${weight};`),
      );
    for (const w of [400, 500, 600]) expect(has("IBM Plex Sans", w), `Sans ${w}`).toBe(true);
    // shell.css sets font-style: italic on admin warnings and notes: ship the face, no synthetic oblique.
    expect(
      faces.some(
        (f) => f.includes('font-family: "IBM Plex Sans"') && f.includes("font-style: italic"),
      ),
    ).toBe(true);
    expect(has("IBM Plex Sans Condensed", 600)).toBe(true);
    for (const w of [400, 500]) expect(has("IBM Plex Mono", w), `Mono ${w}`).toBe(true);
  });

  it("ships the OFL licence beside the files", () => {
    expect(readFileSync(join(fontDir, "OFL.txt"), "utf8")).toContain(
      "SIL OPEN FONT LICENSE Version 1.1",
    );
  });

  it("no external font host: every url() in the stylesheet is local", () => {
    for (const [, url] of shellCss.matchAll(/url\(\s*"?([^")]+)"?\s*\)/g))
      expect(url, url).toMatch(/^\.\//);
  });
});
