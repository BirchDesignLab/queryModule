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

type Surface = ColorTokenName;
const SURFACES: readonly Surface[] = [
  "color.surface.sunken",
  "color.surface.base",
  "color.surface.raised",
  "color.surface.overlay",
];
/** Reading surfaces: where accent text, error text and status text sit. */
const READING: readonly Surface[] = ["color.surface.base", "color.surface.raised"];

/**
 * The design-system pairs (docs/design/2026-09-29-visual-system.md): 7:1 body text on every
 * surface, 4.5:1 secondary text, 3:1 non-text edges and rings. The ring sits outside a 2 px gap,
 * so its neighbour is always a surface, never a button fill.
 */
function designSystemPairs(): ContrastPair[] {
  const pair = (fg: ColorTokenName, bg: ColorTokenName, min: number, use: string) => ({
    fg,
    bg,
    min,
    use,
  });
  return [
    ...SURFACES.filter((bg) => bg !== "color.surface.base" && bg !== "color.surface.raised").map(
      (bg) => pair("color.text.body", bg, 7, "body text on every surface"),
    ),
    pair("color.text.body", "color.accent.subtle", 7, "selected row, pressed chip"),
    pair("color.accent", "color.accent.subtle", 4.5, "type code on a pressed quick-access button"),
    pair("color.text.muted", "color.accent.subtle", 4.5, "timeout on a checked source chip"),
    ...SURFACES.map((bg) => pair("color.text.muted", bg, 4.5, "secondary text (dispatch only)")),
    pair("color.accent.onFill", "color.accent.fill", 4.5, "primary button label"),
    ...SURFACES.filter((bg) => bg !== "color.surface.base").map((bg) =>
      pair("color.border", bg, 3, "control edge (non-text)"),
    ),
    ...SURFACES.filter((bg) => bg !== "color.surface.base").map((bg) =>
      pair("focus.ring", bg, 3, "focus ring (non-text)"),
    ),
    ...READING.map((bg) => pair("field.required", bg, 4.5, "error text, required mark")),
    ...READING.map((bg) => pair("color.status.ok", bg, 4.5, "connected, acknowledged")),
  ];
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
  ...designSystemPairs(),
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
