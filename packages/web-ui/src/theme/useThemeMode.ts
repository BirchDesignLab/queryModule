import type { ThemeModePreference } from "@querymodule/client";
import { resolveThemeMode, type ThemeMode, type ThemeSelection } from "@querymodule/tokens";
import { useEffect, useLayoutEffect, useState } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery.js";

export interface UseThemeModeOptions {
  preference: ThemeModePreference | null;
  /** SiteConfig.theme once GET /api/v1/config is loaded (B P2); null before. */
  selection: ThemeSelection | null;
  root?: HTMLElement;
}

function useLocalHour(active: boolean): number {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    if (!active) return;
    // The hour kept since load may be stale when auto time turns on later (sign-in); read it now.
    setHour(new Date().getHours());
    const id = window.setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => window.clearInterval(id);
  }, [active]);
  return hour;
}

/** Sets `data-theme` on <html>; no reload (spec 6.5). */
export function useThemeMode({ preference, selection, root }: UseThemeModeOptions): ThemeMode {
  const osPrefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  // The clock matters when auto "time" applies: a preference of auto, or none with a site default of auto (D-B1).
  const followsAuto =
    preference === "auto" || (preference === null && selection?.defaultMode === "auto");
  const localHour = useLocalHour(followsAuto && selection?.auto === "time");
  const mode = resolveThemeMode({ preference, selection, osPrefersDark, localHour });
  useLayoutEffect(() => {
    (root ?? document.documentElement).dataset.theme = mode;
  }, [mode, root]);
  return mode;
}
