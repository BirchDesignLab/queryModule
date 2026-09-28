import { savePreferences, useStore } from "@querymodule/client";
import { ThemeModeSelect } from "@querymodule/web-ui";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";

export function HomePage() {
  const { api, authStore, session, preferences } = useServices();
  const t = useT();
  const navigate = useNavigate();
  const user = useStore(authStore, (s) => s.user);
  const themeMode = useStore(preferences, (s) => s.themeMode);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function handleSignOut(): Promise<void> {
    try {
      await session.signOut();
      navigate("/login", { replace: true });
    } catch {
      // Mirrors LoginPage.tsx's error.unavailable handling: a rejection is no longer
      // swallowed silently, so the button always resolves to a visible outcome.
      setSignOutError(t("error.unavailable"));
    }
  }

  return (
    <main className="qm-page">
      <h1 ref={headingRef} tabIndex={-1}>
        {t("app.title")}
      </h1>
      <p>{t("home.signedInAs", { email: user?.email ?? "" })}</p>
      <button
        type="button"
        className="qm-button"
        onClick={() => {
          void handleSignOut();
        }}
      >
        {t("home.signOut")}
      </button>
      {signOutError === null ? null : <p id="home-sign-out-error">{signOutError}</p>}
      <nav aria-label={t("home.navLabel")}>
        <Link to="/status">{t("status.title")}</Link>
      </nav>
      <ThemeModeSelect
        id="home-theme"
        value={themeMode}
        onChange={(mode) => {
          preferences.getState().setThemeMode(mode);
          void savePreferences(api, { themeMode: mode }).catch(() => false);
        }}
        t={t}
      />
    </main>
  );
}
