import { useEffect, useRef } from "react";
import { useT } from "./i18n-context.js";
import { useSignOut } from "./use-sign-out.js";

/**
 * Hard gate (NFR-001, spec 5.1: the client refuses to run below minClientVersion): a signed-in
 * user on an outdated client gets this instead of any protected route. The heading takes focus
 * like every other route (spec 6.4). Sign out stays available (#242): on a shared console
 * the session must be endable even when the app cannot run.
 */
export function UpdateRequiredPage() {
  const t = useT();
  const signOut = useSignOut();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <main className="qm-page">
      <h1 ref={headingRef} tabIndex={-1}>
        {t("update.title")}
      </h1>
      <p>{t("update.body")}</p>
      <button type="button" className="qm-button" onClick={() => void signOut()}>
        {t("home.signOut")}
      </button>
    </main>
  );
}
