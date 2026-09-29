import { useEffect, useRef } from "react";
import { useIsFreshLoad, usePersonaLayout } from "../app/AppChrome.js";
import { useT } from "../app/i18n-context.js";
import { MAIN_LANDMARK } from "../app/main-landmark.js";
import { useServices } from "../app/services-context.js";
import { QueryPanelView } from "./QueryPanelView.js";
import { useLiveConfig } from "./use-query-panel.js";

const ID_PREFIX = "qp";

/** The main screen (spec 6.2): the query panel view over GET /api/v1/config, no per-query-type code (BR-001). */
export function QueryPanel() {
  const t = useT();
  const { drafts } = useServices();
  const live = useLiveConfig();
  const layout = usePersonaLayout();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Focus follows a navigation (sign-in, a link back, browser Back), spec 6.4; a fresh load keeps
  // it at the top of the page, so the first Tab is the skip link.
  const freshLoad = useIsFreshLoad();
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => {
    if (!freshLoad) headingRef.current?.focus();
  }, []);
  return (
    <main
      className={
        layout === "mobileUnit"
          ? "qm-page qm-query-panel qm-layout--mobile-unit"
          : "qm-page qm-query-panel"
      }
      {...MAIN_LANDMARK}
      data-shortcut-context="panel"
      aria-busy={live.status === "loading"}
    >
      <h1 ref={headingRef} tabIndex={-1}>
        {t("app.title")}
      </h1>
      {live.status === "loading" ? <p>{t("status.checking")}</p> : null}
      {live.status === "error" ? (
        <>
          <p className="qm-form-error">{t("error.unavailable")}</p>
          <button
            type="button"
            className="qm-button"
            onClick={() => {
              // The focused Retry unmounts on click; keep focus on the stable heading (spec 6.4).
              headingRef.current?.focus();
              live.retry();
            }}
          >
            {t("app.retry")}
          </button>
        </>
      ) : null}
      {live.status === "ready" ? (
        <QueryPanelView
          config={live.config}
          drafts={drafts}
          mode="live"
          idPrefix={ID_PREFIX}
          onConfigChanged={() => live.refetch()}
        />
      ) : null}
    </main>
  );
}
