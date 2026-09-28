import { useStore } from "@querymodule/client";
import { ThemeModeSelect } from "@querymodule/web-ui";
import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";

export function HomePage() {
  const { authStore, session, preferences } = useServices();
  const t = useT();
  const navigate = useNavigate();
  const user = useStore(authStore, (s) => s.user);
  const themeMode = useStore(preferences, (s) => s.themeMode);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
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
          void session.signOut().then(() => navigate("/login", { replace: true }));
        }}
      >
        {t("home.signOut")}
      </button>
      <nav aria-label={t("home.navLabel")}>
        <Link to="/status">{t("status.title")}</Link>
      </nav>
      <ThemeModeSelect
        id="home-theme"
        value={themeMode}
        onChange={(mode) => preferences.getState().setThemeMode(mode)}
        t={t}
      />
    </main>
  );
}
