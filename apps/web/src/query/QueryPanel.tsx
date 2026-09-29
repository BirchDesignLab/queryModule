import { useEffect, useRef } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { QueryPanelView } from "./QueryPanelView.js";
import { useLiveConfig } from "./use-query-panel.js";

const ID_PREFIX = "qp";

/** The main screen (spec 6.2): the query panel view over GET /api/v1/config, no per-query-type code (BR-001). */
export function QueryPanel() {
  const t = useT();
  const { drafts } = useServices();
  const live = useLiveConfig();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <main
      className="qm-page qm-query-panel"
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
          onConfigChanged={() => void live.refetch()}
        />
      ) : null}
    </main>
  );
}
