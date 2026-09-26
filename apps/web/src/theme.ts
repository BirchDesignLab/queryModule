import { THEME_MODES, type ThemeMode } from "@querymodule/tokens";

export function applyThemeMode(
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
): void {
  if (!(THEME_MODES as readonly string[]).includes(mode))
    throw new Error(`unknown theme mode ${mode}`);
  root.dataset.theme = mode;
}
