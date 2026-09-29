import {
  clientConfigQuery,
  savePreferences,
  type ThemeModePreference,
  useStore,
} from "@querymodule/client";
import {
  type ClientSiteConfig,
  type PERSONA_LAYOUTS,
  resolveShortcuts,
} from "@querymodule/core/config";
import type { ThemeSelection } from "@querymodule/tokens";
import { ShortcutProvider, ThemeModeSeg, usePersona, useThemeMode } from "@querymodule/web-ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { NavLink, Outlet, useLocation, useNavigationType } from "react-router";
import { AdminLink } from "../admin/AdminLink.js";
import { AccountMenu } from "./AccountMenu.js";
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

/** SiteConfig.site.labelKey from the cached config, translated; null before sign-in and after reset. */
function useSiteLabel(): string | null {
  const config = useCachedConfig();
  const t = useT();
  return config === undefined ? null : t(config.site.labelKey);
}

/** Prompt mark: the product's glyph, decorative (the product name beside it is the text). */
function BrandMark() {
  return (
    <svg
      className="qm-app-header__mark"
      viewBox="-4 -4 32 32"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="-4" y="-4" width="32" height="32" rx="8" />
      <path d="M6 8l4 4-4 4M12 17h6" />
    </svg>
  );
}

/**
 * The signed-in header (D-B4, design B1): product mark and name, site name, the Main nav (Queries,
 * Status, Admin), then the account disclosure (user, role, theme, sign out). The mobile-unit bar
 * is the compact one: the same nav, the theme select and sign out inline (its own look is B4).
 * It needs the router and the translator, so it lives under the routes, not beside AppChrome.
 */
export function AppHeader() {
  const { api, authStore, preferences } = useServices();
  const t = useT();
  const signOut = useSignOut();
  const user = useStore(authStore, (s) => s.user);
  const themeMode = useStore(preferences, (s) => s.themeMode);
  const layout = usePersonaLayout();
  const siteLabel = useSiteLabel();
  const compact = layout === "mobileUnit";
  const changeTheme = (mode: ThemeModePreference) => {
    preferences.getState().setThemeMode(mode);
    void savePreferences(api, { themeMode: mode }).catch(() => false);
  };
  const doSignOut = () => {
    void signOut();
  };
  return (
    <header className={compact ? "qm-app-header qm-app-header--compact" : "qm-app-header"}>
      {/* Product name as plain text: each page owns its h1. */}
      <p className="qm-app-header__product">
        <BrandMark />
        {t("login.product")}
      </p>
      {compact || siteLabel === null ? null : <p className="qm-app-header__site">{siteLabel}</p>}
      <nav className="qm-app-header__nav" aria-label={t("home.navLabel")}>
        <NavLink className="qm-app-header__link" to="/" end>
          {t("nav.queries")}
        </NavLink>
        <NavLink className="qm-app-header__link" to="/status">
          {t("nav.status")}
        </NavLink>
        <AdminLink />
      </nav>
      <div className="qm-app-header__end">
        {compact ? <ThemeModeSeg value={themeMode} onChange={changeTheme} t={t} icons /> : null}
        <AccountMenu
          // A flip between the two bars remounts it: an open panel closes and focus goes to <main>.
          key={compact ? "compact" : "full"}
          email={user?.email ?? ""}
          role={user?.role ?? null}
          themeMode={themeMode}
          onThemeChange={changeTheme}
          onSignOut={doSignOut}
          showTheme={!compact}
        />
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

/** True until the router location changes after AppShell mounted: the document is still on its entry. */
const OnLoadEntry = createContext<{ current: boolean } | null>(null);

/**
 * True when a page mounts on the entry the document was loaded on (a fresh load or a reload, POP):
 * focus then stays at the top of the page, so the first Tab is the skip link. A page reached by
 * any navigation (sign-in, a link, browser Back, even Back to the loaded entry) is false: focus
 * follows it (spec 6.4).
 */
export function useIsFreshLoad(): boolean {
  const onLoadEntry = useContext(OnLoadEntry);
  const navigationType = useNavigationType();
  return onLoadEntry?.current === true && navigationType === "POP";
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
  const locationKey = useLocation().key;
  const firstKey = useRef(locationKey);
  const onLoadEntry = useRef(true);
  // The first navigation ends "fresh load" for good: Back to the loaded entry is a navigation too.
  useEffect(() => {
    if (locationKey !== firstKey.current) onLoadEntry.current = false;
  }, [locationKey]);
  const shortcuts = useCachedConfig()?.shortcuts;
  const bindings = useMemo(() => resolveShortcuts(shortcuts), [shortcuts]);
  return (
    <ShortcutProvider bindings={bindings}>
      <OnLoadEntry.Provider value={onLoadEntry}>
        <SkipLink />
        <AppHeader />
        <Outlet />
      </OnLoadEntry.Provider>
    </ShortcutProvider>
  );
}
