export const THEME_MODES = ["day", "night", "redShift"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
type ModeValues = Readonly<Record<ThemeMode, string>>;

/** Semantic colour tokens, one value per mode. redShift: amber and red on near-black, no blue-dominant colour. */
export const COLOR_TOKENS = {
  "color.text.body": { day: "#1a1a1a", night: "#e8e8e8", redShift: "#ffb000" },
  "color.surface.base": { day: "#ffffff", night: "#121212", redShift: "#0d0000" },
  "color.surface.raised": { day: "#f2f2f2", night: "#1e1e1e", redShift: "#1a0500" },
  "color.border": { day: "#767676", night: "#8a8a8a", redShift: "#a05a00" },
  "color.severity.critical.fg": { day: "#ffffff", night: "#ffffff", redShift: "#0d0000" },
  "color.severity.critical.bg": { day: "#a00000", night: "#8b0000", redShift: "#ff4d4d" },
  "color.severity.warning.fg": { day: "#1a1a1a", night: "#121212", redShift: "#0d0000" },
  "color.severity.warning.bg": { day: "#ffd24d", night: "#e0b000", redShift: "#ffb000" },
  "color.severity.info.fg": { day: "#ffffff", night: "#ffffff", redShift: "#0d0000" },
  "color.severity.info.bg": { day: "#1f5fbf", night: "#1f5fbf", redShift: "#c08040" },
  "focus.ring": { day: "#1f5fbf", night: "#ffd24d", redShift: "#ff4d4d" },
  "field.required": { day: "#a00000", night: "#ff8080", redShift: "#ff4d4d" },
} as const satisfies Record<string, ModeValues>;

export const SCALE_TOKENS = {
  "space.1": "4px",
  "space.2": "8px",
  "space.3": "12px",
  "space.4": "16px",
  "space.6": "24px",
  "type.family": "system-ui, sans-serif",
  "type.body.size": "16px",
  "type.body.lineHeight": "1.5",
  "type.heading.size": "24px",
  "radius.sm": "4px",
  "radius.md": "8px",
  "motion.duration.fast": "120ms",
  "motion.duration.normal": "200ms",
  "target.min": "48px",
} as const;

export type ColorTokenName = keyof typeof COLOR_TOKENS;
export type ScaleTokenName = keyof typeof SCALE_TOKENS;
export type TokenName = ColorTokenName | ScaleTokenName;

export const TOKEN_NAMES: readonly TokenName[] = [
  ...(Object.keys(COLOR_TOKENS) as ColorTokenName[]),
  ...(Object.keys(SCALE_TOKENS) as ScaleTokenName[]),
];

/** Motion tokens drop to zero under reduced-motion settings. */
export const MOTION_TOKENS: readonly ScaleTokenName[] = [
  "motion.duration.fast",
  "motion.duration.normal",
];

export function tokenValue(name: TokenName, mode: ThemeMode): string {
  if (name in COLOR_TOKENS) return COLOR_TOKENS[name as ColorTokenName][mode];
  return SCALE_TOKENS[name as ScaleTokenName];
}
