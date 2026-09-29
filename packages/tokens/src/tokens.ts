export const THEME_MODES = ["day", "night", "redShift"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
type ModeValues = Readonly<Record<ThemeMode, string>>;

/** Semantic colour tokens, one value per mode. redShift: amber and red on near-black, no blue-dominant colour. */
export const COLOR_TOKENS = {
  "color.text.body": { day: "#121820", night: "#e7ecf2", redShift: "#ffb000" },
  "color.text.muted": { day: "#4d5968", night: "#9eabbc", redShift: "#d98f1a" },
  "color.surface.sunken": { day: "#eceff3", night: "#0a0e13", redShift: "#080000" },
  "color.surface.base": { day: "#ffffff", night: "#10151c", redShift: "#0d0000" },
  "color.surface.raised": { day: "#f7f9fb", night: "#161d26", redShift: "#1a0500" },
  "color.surface.overlay": { day: "#ffffff", night: "#1e2733", redShift: "#240900" },
  "color.accent": { day: "#0b4a9e", night: "#8ab4ff", redShift: "#ff8c1a" },
  "color.accent.fill": { day: "#0b4a9e", night: "#8ab4ff", redShift: "#ff8c1a" },
  "color.accent.onFill": { day: "#ffffff", night: "#0a0e13", redShift: "#0d0000" },
  "color.accent.subtle": { day: "#e1ebfa", night: "#1b2f4d", redShift: "#3a1800" },
  "color.status.ok": { day: "#0f6b44", night: "#5fd39a", redShift: "#e0b84a" },
  "color.border": { day: "#7a8494", night: "#66768a", redShift: "#a05a00" },
  "color.border.subtle": { day: "#dde2e8", night: "#263140", redShift: "#3a1600" },
  "color.severity.critical.fg": { day: "#ffffff", night: "#ffffff", redShift: "#0d0000" },
  "color.severity.critical.bg": { day: "#a00000", night: "#8b0000", redShift: "#ff4d4d" },
  "color.severity.warning.fg": { day: "#1a1a1a", night: "#121212", redShift: "#0d0000" },
  "color.severity.warning.bg": { day: "#ffd24d", night: "#e0b000", redShift: "#ffb000" },
  "color.severity.info.fg": { day: "#ffffff", night: "#ffffff", redShift: "#0d0000" },
  "color.severity.info.bg": { day: "#1f5fbf", night: "#1f5fbf", redShift: "#c08040" },
  // E1: the ring never matches the invalid edge (field.required); red shift's ring is pale amber.
  "focus.ring": { day: "#1f5fbf", night: "#ffd24d", redShift: "#ffe0a8" },
  "field.required": { day: "#a00000", night: "#ff8080", redShift: "#ff4d4d" },
} as const satisfies Record<string, ModeValues>;

export const SCALE_TOKENS = {
  "space.1": "4px",
  "space.2": "8px",
  "space.3": "12px",
  "space.4": "16px",
  "space.5": "20px",
  "space.6": "24px",
  "space.8": "32px",
  "space.12": "48px",
  // IBM Plex is self-hosted (apps/web/src/fonts, bundled under /assets, spec 6.5); a system face ends every stack.
  "type.family": '"IBM Plex Sans", system-ui, sans-serif',
  "type.family.label": '"IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif',
  "type.family.data": '"IBM Plex Mono", ui-monospace, monospace',
  "type.size.xs": "12px",
  "type.size.sm": "13px",
  "type.size.md": "14px",
  "type.size.lg": "16px",
  "type.size.xl": "20px",
  "type.size.2xl": "24px",
  "type.size.3xl": "32px",
  "type.body.size": "16px",
  "type.body.lineHeight": "1.5",
  "type.heading.size": "24px",
  "border.width": "1px",
  "focus.ring.width": "2px",
  "focus.ring.offset": "2px",
  "radius.sm": "4px",
  "radius.control": "6px",
  "radius.md": "8px",
  "radius.panel": "10px",
  "motion.duration.fast": "120ms",
  "motion.duration.normal": "200ms",
  "target.min": "48px",
  // Density is set by the persona layout, never by width (spec 6.1, 6.3).
  "control.height.dense": "36px",
  "control.height.touch": "56px",
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
