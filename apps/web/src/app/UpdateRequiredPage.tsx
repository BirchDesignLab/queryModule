import { useEffect, useRef } from "react";
import { useT } from "./i18n-context.js";

/**
 * Hard gate (NFR-001, spec 5.1: the client refuses to run below minClientVersion): a signed-in
 * user on an outdated client gets this instead of any protected route. The heading takes focus
 * like every other route (spec 6.4).
 */
export function UpdateRequiredPage() {
  const t = useT();
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
    </main>
  );
}
