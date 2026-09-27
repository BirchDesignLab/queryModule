import { COLOR_TOKENS, type ColorTokenName, type ThemeMode } from "./tokens";

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ContrastPair {
  fg: ColorTokenName;
  bg: ColorTokenName;
  min: number;
  use: string;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  {
    fg: "color.text.body",
    bg: "color.surface.base",
    min: 7,
    use: "body text; 7:1 in every mode (mobile unit, spec 6.3)",
  },
  {
    fg: "color.text.body",
    bg: "color.surface.raised",
    min: 7,
    use: "body text on raised surfaces",
  },
  {
    fg: "color.accent",
    bg: "color.surface.base",
    min: 7,
    use: "links and accent text; 7:1 like body text",
  },
  { fg: "color.accent", bg: "color.surface.raised", min: 7, use: "accent text on raised surfaces" },
  {
    fg: "color.severity.critical.fg",
    bg: "color.severity.critical.bg",
    min: 4.5,
    use: "critical severity style",
  },
  {
    fg: "color.severity.warning.fg",
    bg: "color.severity.warning.bg",
    min: 4.5,
    use: "warning severity style",
  },
  {
    fg: "color.severity.info.fg",
    bg: "color.severity.info.bg",
    min: 4.5,
    use: "info severity style",
  },
  { fg: "field.required", bg: "color.surface.base", min: 3, use: "required marker (non-text)" },
  { fg: "focus.ring", bg: "color.surface.base", min: 3, use: "focus ring (non-text)" },
  {
    fg: "color.border",
    bg: "color.surface.base",
    min: 3,
    use: "control and badge edge (non-text)",
  },
];

/** Pairs below target in a mode, with optional site overrides (SiteConfig.theme.tokens) applied. */
export function contrastFailures(
  mode: ThemeMode,
  overrides: Record<string, string> = {},
): { pair: ContrastPair; ratio: number }[] {
  const value = (name: ColorTokenName) => overrides[name] ?? COLOR_TOKENS[name][mode];
  return CONTRAST_PAIRS.map((pair) => ({
    pair,
    ratio: contrastRatio(value(pair.fg), value(pair.bg)),
  })).filter((r) => r.ratio < r.pair.min);
}
