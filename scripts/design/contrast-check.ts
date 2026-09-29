/**
 * Contrast check for the proposed visual system (docs/design/2026-09-29-visual-system.md).
 * The palette below is a proposal, not yet in packages/tokens; the implementation task moves it
 * there and the tokens package tests take over. Run: pnpm tsx scripts/design/contrast-check.ts
 * Exits 1 when any pair is below its minimum.
 */
import { contrastRatio } from "../../packages/tokens/src/contrast";

type Mode = "day" | "night" | "redShift";
type Palette = Record<string, string>;

export const PROPOSED: Record<Mode, Palette> = {
  night: {
    "color.surface.sunken": "#0a0e13",
    "color.surface.base": "#10151c",
    "color.surface.raised": "#161d26",
    "color.surface.overlay": "#1e2733",
    "color.border": "#66768a",
    "color.border.subtle": "#263140",
    "color.text.body": "#e7ecf2",
    "color.text.muted": "#9eabbc",
    "color.accent": "#8ab4ff",
    "color.accent.fill": "#8ab4ff",
    "color.accent.onFill": "#0a0e13",
    "color.accent.subtle": "#1b2f4d",
    "color.status.ok": "#5fd39a",
    "focus.ring": "#ffd24d",
    "field.required": "#ff8080",
  },
  day: {
    "color.surface.sunken": "#eceff3",
    "color.surface.base": "#ffffff",
    "color.surface.raised": "#f7f9fb",
    "color.surface.overlay": "#ffffff",
    "color.border": "#7a8494",
    "color.border.subtle": "#dde2e8",
    "color.text.body": "#121820",
    "color.text.muted": "#4d5968",
    "color.accent": "#0b4a9e",
    "color.accent.fill": "#0b4a9e",
    "color.accent.onFill": "#ffffff",
    "color.accent.subtle": "#e1ebfa",
    "color.status.ok": "#0f6b44",
    "focus.ring": "#1f5fbf",
    "field.required": "#a00000",
  },
  redShift: {
    "color.surface.sunken": "#080000",
    "color.surface.base": "#0d0000",
    "color.surface.raised": "#1a0500",
    "color.surface.overlay": "#240900",
    "color.border": "#a05a00",
    "color.border.subtle": "#3a1600",
    "color.text.body": "#ffb000",
    "color.text.muted": "#d98f1a",
    "color.accent": "#ff8c1a",
    "color.accent.fill": "#ff8c1a",
    "color.accent.onFill": "#0d0000",
    "color.accent.subtle": "#3a1800",
    "color.status.ok": "#e0b84a",
    "focus.ring": "#ffe0a8",
    "field.required": "#ff4d4d",
  },
};

interface Pair {
  fg: string;
  bg: string;
  min: number;
  use: string;
}

const SURFACES = [
  "color.surface.sunken",
  "color.surface.base",
  "color.surface.raised",
  "color.surface.overlay",
];

/** 7:1 body text in every mode (spec 6.3 mobile unit, kept everywhere); 4.5:1 other text; 3:1 non-text (WCAG 2.2 1.4.11). */
export const PAIRS: Pair[] = [
  ...SURFACES.map((bg) => ({ fg: "color.text.body", bg, min: 7, use: "body text" })),
  { fg: "color.text.body", bg: "color.accent.subtle", min: 7, use: "selected row, pressed chip" },
  ...SURFACES.map((bg) => ({
    fg: "color.text.muted",
    bg,
    min: 4.5,
    use: "secondary text (dispatch only)",
  })),
  ...SURFACES.slice(1, 3).map((bg) => ({
    fg: "color.accent",
    bg,
    min: 7,
    use: "links, accent text",
  })),
  { fg: "color.accent.onFill", bg: "color.accent.fill", min: 4.5, use: "primary button label" },
  ...SURFACES.slice(1).map((bg) => ({ fg: "color.border", bg, min: 3, use: "control edge" })),
  ...SURFACES.map((bg) => ({ fg: "focus.ring", bg, min: 3, use: "focus ring" })),
  // The ring sits outside a 2px offset, so its neighbour is always a surface, never the button fill.
  ...SURFACES.slice(1, 3).map((bg) => ({
    fg: "field.required",
    bg,
    min: 4.5,
    use: "error text, required mark",
  })),
  ...SURFACES.slice(1, 3).map((bg) => ({
    fg: "color.status.ok",
    bg,
    min: 4.5,
    use: "connected, acknowledged",
  })),
];

let failures = 0;
for (const mode of Object.keys(PROPOSED) as Mode[]) {
  const p = PROPOSED[mode];
  for (const pair of PAIRS) {
    const ratio = contrastRatio(p[pair.fg] as string, p[pair.bg] as string);
    const ok = ratio >= pair.min;
    if (!ok) failures++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${mode.padEnd(8)} ${pair.fg} on ${pair.bg}: ${ratio.toFixed(2)} (min ${pair.min}, ${pair.use})`,
    );
  }
}
console.log(failures === 0 ? "all pairs pass" : `${failures} pair(s) below minimum`);
process.exitCode = failures === 0 ? 0 : 1;
