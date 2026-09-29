import { clientConfigQuery, savePreferences, useStore } from "@querymodule/client";
import {
  type ClientSiteConfig,
  type PERSONA_LAYOUTS,
  resolveShortcuts,
} from "@querymodule/core/config";
import type { ThemeSelection } from "@querymodule/tokens";
import { ShortcutProvider, ThemeModeSelect, usePersona, useThemeMode } from "@querymodule/web-ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { AdminLink } from "../admin/AdminLink.js";
import { useT } from "./i18n-context.js";
import { MAIN_LANDMARK } from "./main-landmark.js";
import { useServices } from "./services-context.js";
import { useSignOut } from "./use-sign-out.js";

/** The cached GET /api/v1/config (key ["config"], filled by the query panel), or undefined before sign-in and after reset. */
function useCachedConfig(): ClientSiteConfig | undefined {
  const { queryClient } = useServices();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  return useSyncExternalStore(subscribe, () =>
    queryClient.getQueryData<ClientSiteConfig>(["config"]),
  );
}

/**
 * SiteConfig.theme from the cached config, or null before sign-in and after reset, when the OS
 * scheme decides (spec 6.5, #175).
 */
function useSiteThemeSelection(): ThemeSelection | null {
  const config = useCachedConfig();
  if (config === undefined) return null;
  return { defaultMode: config.theme?.defaultMode ?? "day", auto: config.theme?.auto ?? "off" };
}

type PersonaLayout = (typeof PERSONA_LAYOUTS)[number];

/**
 * The signed-in persona's layout from SiteConfig.personas (spec 6.1: the persona selects the layout
 * and nothing else), "dispatch" until the config loads (BR-002).
 */
export function usePersonaLayout(): PersonaLayout {
  const { preferences } = useServices();
  const personaOverride = useStore(preferences, (s) => s.personaOverride);
  const { persona } = usePersona(null, personaOverride);
  const config = useCachedConfig();
  return config?.personas.find((p) => p.key === persona)?.layout ?? "dispatch";
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
  const layout = usePersonaLayout();
  const onPanel = useLocation().pathname === "/";
  return (
    <header
      className={layout === "mobileUnit" ? "qm-app-header qm-app-header--compact" : "qm-app-header"}
    >
      {/* Product name as plain text: each page owns its h1. */}
      <p className="qm-app-header__product">{t("login.product")}</p>
      <div className="qm-app-header__end">
        <nav aria-label={t("home.navLabel")}>
          {onPanel ? null : (
            <Link className="qm-app-header__status" to="/">
              {t("nav.query")}
            </Link>
          )}
          <Link className="qm-app-header__status" to="/status">
            {t("status.title")}
          </Link>
          <AdminLink />
        </nav>
        <p className="qm-app-header__user">{t("home.signedInAs", { email: user?.email ?? "" })}</p>
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
      </div>
    </header>
  );
}

/**
 * The first Tab stop of every signed-in page (spec 6.4): an in-page link past the header to the
 * page's `<main>`, which takes focus, so the next Tab enters the page. "Skip to query" on the
 * panel, "Skip to main content" elsewhere.
 */
function SkipLink() {
  const t = useT();
  const onPanel = useLocation().pathname === "/";
  return (
    <a className="qm-skip-link" href={`#${MAIN_LANDMARK.id}`}>
      {t(onPanel ? "skip.toQuery" : "skip.toMain")}
    </a>
  );
}

/** Layout of every signed-in screen that runs the app: the header, then the page. */
export function AppShell() {
  const { api, queryClient, configRefresh, authStore } = useServices();
  const signedInAs = useStore(authStore, (s) => s.user?.email);
  // Refetch the config every 15 s and when the tab becomes visible, while signed in (ADR-0011
  // item 3). A reset (sign-out, 401, user change) stops it; a new user restarts it.
  useEffect(() => {
    if (signedInAs === undefined) return;
    configRefresh.start();
    return () => configRefresh.stop();
  }, [configRefresh, signedInAs]);
  // Load GET /api/v1/config on every signed-in screen, not only the panel, so SiteConfig.theme
  // applies after a reload on /status too (spec 6.5); the panel reuses the cached entry.
  useEffect(() => {
    void queryClient.prefetchQuery({ ...clientConfigQuery(api), retry: false });
  }, [api, queryClient]);
  // Bindings are the site's overrides over the spec 6.4 defaults; the defaults apply until the config loads.
  const shortcuts = useCachedConfig()?.shortcuts;
  const bindings = useMemo(() => resolveShortcuts(shortcuts), [shortcuts]);
  return (
    <ShortcutProvider bindings={bindings}>
      <SkipLink />
      <AppHeader />
      <Outlet />
    </ShortcutProvider>
  );
}
