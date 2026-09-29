import { savePreferences, useStore } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import type { ThemeSelection } from "@querymodule/tokens";
import { ThemeModeSelect, usePersona, useThemeMode } from "@querymodule/web-ui";
import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { Link, Outlet } from "react-router";
import { useT } from "./i18n-context.js";
import { useServices } from "./services-context.js";
import { useSignOut } from "./use-sign-out.js";

/**
 * SiteConfig.theme from the cached GET /api/v1/config (key ["config"], filled by the query panel),
 * or null before sign-in and after reset, when the OS scheme decides (spec 6.5, #175).
 */
function useSiteThemeSelection(): ThemeSelection | null {
  const { queryClient } = useServices();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const config = useSyncExternalStore(subscribe, () =>
    queryClient.getQueryData<ClientSiteConfig>(["config"]),
  );
  if (config === undefined) return null;
  return { defaultMode: config.theme?.defaultMode ?? "day", auto: config.theme?.auto ?? "off" };
}

/** Applies theme mode (user preference, then SiteConfig.theme) and persona to <html>. */
export function AppChrome() {
  const { preferences } = useServices();
  const themeMode = useStore(preferences, (s) => s.themeMode);
  const personaOverride = useStore(preferences, (s) => s.personaOverride);
  const selection = useSiteThemeSelection();
  useThemeMode({ preference: themeMode, selection });
  const { persona } = usePersona(null, personaOverride);
  useLayoutEffect(() => {
    document.documentElement.dataset.persona = persona;
  }, [persona]);
  return null;
}

/**
 * The signed-in header (D-B4): who is signed in, the status link, the theme select and sign-out.
 * It needs the router and the translator, so it lives under the routes, not beside AppChrome.
 */
export function AppHeader() {
  const { api, authStore, preferences } = useServices();
  const t = useT();
  const signOut = useSignOut();
  const user = useStore(authStore, (s) => s.user);
  const themeMode = useStore(preferences, (s) => s.themeMode);
  return (
    <header className="qm-app-header">
      <p className="qm-app-header__user">{t("home.signedInAs", { email: user?.email ?? "" })}</p>
      <nav aria-label={t("home.navLabel")}>
        <Link to="/status">{t("status.title")}</Link>
      </nav>
      <ThemeModeSelect
        id="app-theme"
        value={themeMode}
        onChange={(mode) => {
          preferences.getState().setThemeMode(mode);
          void savePreferences(api, { themeMode: mode }).catch(() => false);
        }}
        t={t}
      />
      <button
        type="button"
        className="qm-button"
        onClick={() => {
          void signOut();
        }}
      >
        {t("home.signOut")}
      </button>
    </header>
  );
}

/** Layout of every signed-in screen that runs the app: the header, then the page. */
export function AppShell() {
  return (
    <>
      <AppHeader />
      <Outlet />
    </>
  );
}
