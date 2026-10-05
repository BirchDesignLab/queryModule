import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cssVarName, LAYOUT_CONSTANTS, TOKEN_NAMES } from "@querymodule/tokens";
import { describe, expect, it } from "vitest";

// Read from disk (T20/IC1 precedent): jsdom's global URL breaks readFileSync(new URL(...)),
// and a "?raw" CSS import resolves to "" under vitest, which would make this guard vacuous.
const shellCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell.css"), "utf8");

// A length in any spelling: case, exponent and leading point included.
const LENGTH = /(?<![\w.])(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?:px|rem|em)\b/gi;
const COMMENT = /\/\*[\s\S]*?\*\//g;
const QUERY_PRELUDE = /@(?:media|container)\b[^{;]*\{/gi;

/**
 * Every literal length in `css` that is not allowed: any length in a comment or outside a query
 * condition, and in a @media or @container condition any length that is not one of `allowed` (the
 * layout constants). A condition cannot read var(), so that is the only place a literal length may
 * appear. Comments are read apart from the code, so one cannot open or close a condition.
 */
function forbiddenLengths(css: string, allowed: readonly string[]): string[] {
  const out: string[] = [];
  for (const [comment] of css.matchAll(COMMENT))
    for (const [length] of comment.matchAll(LENGTH)) out.push(length);
  const rest = css.replace(COMMENT, "").replace(QUERY_PRELUDE, (prelude) => {
    for (const [length] of prelude.matchAll(LENGTH))
      if (!allowed.includes(length)) out.push(length);
    return "{";
  });
  for (const [length] of rest.matchAll(LENGTH)) out.push(length);
  return out;
}

describe("shell.css uses token variables only (spec 6.5)", () => {
  it("has no literal colours or sizes, no var() fallbacks, only known token names", () => {
    expect(shellCss).toContain("body");
    expect(shellCss).toContain(":focus-visible");
    expect(shellCss).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|lab\(|lch\(|hwb\(|color\(/,
    );
    expect(forbiddenLengths(shellCss, Object.values(LAYOUT_CONSTANTS))).toEqual([]);
    expect(shellCss).not.toMatch(/var\(--[\w-]+\s*,/);
    const known = new Set(
      [...TOKEN_NAMES, ...Object.keys(LAYOUT_CONSTANTS)].map((n) => cssVarName(n)),
    );
    for (const [, name] of shellCss.matchAll(/var\((--[\w-]+)\)/g))
      expect(known.has(name ?? ""), name).toBe(true);
  });

  it("dims through the shared tokens: one inert opacity, the scrim colour, the layout constant", () => {
    const rule = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(
        shellCss,
      )?.[1] ?? "";
    expect(rule(".qm-preview__panel[data-paused]")).toContain("opacity: var(--qm-opacity-inert)");
    expect(shellCss).toMatch(
      /@keyframes qm-preview-pulse\s*\{\s*50%\s*\{\s*opacity: var\(--qm-opacity-inert\);/,
    );
    expect(rule(".qm-leave-dialog::backdrop")).toContain("var(--qm-color-surface-scrim)");
    expect(rule(".qm-leave-dialog::backdrop")).toContain("opacity: var(--qm-opacity-scrim)");
    // The breakpoints are real query conditions at the layout constants, not a hand-tuned
    // multiple of a spacing token nor the calc-times-1000 trick.
    for (const value of Object.values(LAYOUT_CONSTANTS))
      expect(shellCss, value).toMatch(new RegExp(`@(media|container)[^{]*\\b${value}\\b`));
    expect(shellCss).not.toContain("21.34");
    expect(shellCss).not.toMatch(/\)\s*\*\s*1000\b/);
  });
});

describe("literal lengths: only in a query condition, and only a layout constant", () => {
  // A query condition cannot read var(), so its lengths are literals; each must equal a fixed
  // layout constant from the tokens package, which is the one place the breakpoint is written.
  const allowed = Object.values(LAYOUT_CONSTANTS);
  const check = (css: string) => forbiddenLengths(css, allowed);

  it("accepts a layout constant in @media and @container conditions", () => {
    for (const value of allowed) {
      expect(check(`@media (min-width: ${value}) { .a { color: red; } }`)).toEqual([]);
      expect(check(`@container (min-width: ${value}) { .a { color: red; } }`)).toEqual([]);
      expect(check(`@container rail (width >= ${value}) { .a { color: red; } }`)).toEqual([]);
    }
  });

  it("rejects any other length in a condition, even next to a constant", () => {
    expect(check("@media (min-width: 50rem) { .a { top: 0; } }")).toEqual(["50rem"]);
    expect(check("@media (min-width: 64rem) { .a { top: 0; } }")).toEqual(["64rem"]);
    expect(check("@media (min-width: 1000px) { .a { top: 0; } }")).toEqual(["1000px"]);
    expect(check("@container (min-width: 40em) { .a { top: 0; } }")).toEqual(["40em"]);
    const [wide = ""] = allowed;
    expect(check(`@media (min-width: ${wide}) and (max-width: 70rem) { .a { top: 0; } }`)).toEqual([
      "70rem",
    ]);
    // A constant's value that is off by a digit is not the constant.
    expect(check("@media (min-width: 1024.5px) { .a { top: 0; } }")).toEqual(["1024.5px"]);
  });

  it("rejects a length however it is written: case, exponent, leading point", () => {
    expect(check(".a { inline-size: 64REM; }")).toEqual(["64REM"]);
    expect(check(".a { inline-size: 12Px; }")).toEqual(["12Px"]);
    expect(check(".a { inline-size: 1e3px; }")).toEqual(["1e3px"]);
    expect(check(".a { inline-size: .5rem; }")).toEqual([".5rem"]);
    expect(check("@media (min-width: 50REM) { .a { top: 0; } }")).toEqual(["50REM"]);
    expect(check("@MEDIA (min-width: 50rem) { .a { top: 0; } }")).toEqual(["50rem"]);
  });

  it("does not let a comment open a condition: a constant in a rule body still fails", () => {
    const [wide = ""] = allowed;
    expect(check(`.a { /* @media */ inline-size: ${wide}; } .b { top: 0; }`)).toEqual([wide]);
    expect(check(`/* @container ( */ .a { inline-size: ${wide}; }`)).toEqual([wide]);
    // A length in a comment is still a literal length.
    expect(check("/* about 12px */ .a { top: 0; }")).toEqual(["12px"]);
  });

  it("rejects every literal length outside a condition, constant values included", () => {
    const [wide = ""] = allowed;
    expect(check(`.a { inline-size: ${wide}; }`)).toEqual([wide]);
    expect(check(`@media (min-width: ${wide}) { .a { inline-size: 12px; } }`)).toEqual(["12px"]);
    expect(check(".a { margin: 4px 8px; padding: 1.5em; }")).toEqual(["4px", "8px", "1.5em"]);
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
