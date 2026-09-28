import { useStore } from "@querymodule/client";
import { usePersona, useThemeMode } from "@querymodule/web-ui";
import { useLayoutEffect } from "react";
import { useServices } from "./services-context.js";

/** Applies theme mode and persona to <html>. Site theme selection arrives with GET config in B P2. */
export function AppChrome() {
  const { preferences } = useServices();
  const themeMode = useStore(preferences, (s) => s.themeMode);
  const personaOverride = useStore(preferences, (s) => s.personaOverride);
  useThemeMode({ preference: themeMode, selection: null });
  const { persona } = usePersona(null, personaOverride);
  useLayoutEffect(() => {
    document.documentElement.dataset.persona = persona;
  }, [persona]);
  return null;
}
