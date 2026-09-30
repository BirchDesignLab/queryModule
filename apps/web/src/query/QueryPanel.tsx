import { useEffect, useLayoutEffect, useRef } from "react";
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
  // #382 T18-4 (spec 6.6, Revision 2 "Focus is never lost"): a newer config (or a refetch that
  // fails into the error state) that removes the focused control leaves focus on <body>; hand it to
  // the heading. The render that sees the new hash notes what had focus in <main>; the controls the
  // config drops leave the DOM in that same commit, so the layout effect sees them gone. Focus
  // anywhere that survived, or already off the panel, is left alone; no announcement is added.
  const mainRef = useRef<HTMLElement>(null);
  const configHash = live.status === "ready" ? live.config.configHash : null;
  const seenHash = useRef(configHash);
  const focusedAtChange = useRef<Element | null>(null);
  if (configHash !== seenHash.current) {
    const active = typeof document === "undefined" ? null : document.activeElement;
    focusedAtChange.current = active !== null && mainRef.current?.contains(active) ? active : null;
  }
  useLayoutEffect(() => {
    const previous = seenHash.current;
    seenHash.current = configHash;
    const focused = focusedAtChange.current;
    focusedAtChange.current = null;
    if (previous === null || previous === configHash || focused === null) return;
    const active = document.activeElement;
    if (!focused.isConnected && (active === null || active === document.body))
      headingRef.current?.focus();
  }, [configHash]);
  return (
    <main
      ref={mainRef}
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
          requests={layout === "mobileUnit" ? "last" : "list"}
        />
      ) : null}
    </main>
  );
}
