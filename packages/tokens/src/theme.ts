import {
  COLOR_TOKENS,
  type ColorTokenName,
  SCALE_TOKENS,
  type ScaleTokenName,
  type ThemeMode,
} from "./tokens";

export interface ThemeObject {
  mode: ThemeMode;
  colors: Record<ColorTokenName, string>;
  scale: Record<ScaleTokenName, string>;
}

/** Typed theme object for React Native; overrides are SiteConfig.theme.tokens values for this mode. */
export function buildTheme(mode: ThemeMode, overrides: Record<string, string> = {}): ThemeObject {
  const colors = {} as Record<ColorTokenName, string>;
  for (const name of Object.keys(COLOR_TOKENS) as ColorTokenName[])
    colors[name] = overrides[name] ?? COLOR_TOKENS[name][mode];
  const scale = {} as Record<ScaleTokenName, string>;
  for (const name of Object.keys(SCALE_TOKENS) as ScaleTokenName[])
    scale[name] = overrides[name] ?? SCALE_TOKENS[name];
  return { mode, colors, scale };
}
