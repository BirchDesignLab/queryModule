import { useStore } from "@querymodule/client";
import { LAYOUT_CONSTANTS } from "@querymodule/tokens";
import { useMediaQuery, visuallyHiddenStyle } from "@querymodule/web-ui";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useIsFreshLoad, usePersonaLayout } from "../app/AppChrome.js";
import { useT } from "../app/i18n-context.js";
import { MAIN_LANDMARK } from "../app/main-landmark.js";
import { useServices } from "../app/services-context.js";
import { QueryPanelView } from "./QueryPanelView.js";
import { useLiveConfig } from "./use-query-panel.js";

const ID_PREFIX = "qp";

/** The window width from which the terminal can sit beside the results (D-M2P2-B2). */
const TERMINAL_PANE_QUERY = `(min-width: ${LAYOUT_CONSTANTS["layout.terminalPane"]})`;

/** The main screen (spec 6.2): the query panel view over GET /api/v1/config, no per-query-type code (BR-001). */
export function QueryPanel() {
  const t = useT();
  const { drafts, preferences } = useServices();
  const live = useLiveConfig();
  const layout = usePersonaLayout();
  // The terminal beside the results (FR-050, UX-014): the stored choice, at a window wide enough,
  // on the dispatch layout (the officer layout is one column). Narrower, the toggle returns.
  const wantsPane = useStore(preferences, (s) => s.layout?.terminal === "pane");
  const wideEnough = useMediaQuery(TERMINAL_PANE_QUERY);
  const terminalPane = wantsPane && wideEnough && layout !== "mobileUnit";
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
    const dropped = active === null || active === document.body;
    // Removed, or still in the DOM but inside a closed disclosure ([hidden]): the browser drops the
    // focus of a hidden element at its next rendering update, so it counts as gone too.
    const removed = !focused.isConnected && dropped;
    const hidden =
      focused.isConnected &&
      focused.closest("[hidden]") !== null &&
      (dropped || active === focused);
    if (removed || hidden) headingRef.current?.focus();
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
      {/* With the terminal pane the columns start under the header (mockup v6): the title stays
          for the outline and as the focus target, out of sight. */}
      <h1 ref={headingRef} tabIndex={-1} style={terminalPane ? visuallyHiddenStyle : undefined}>
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
          terminalPane={terminalPane}
        />
      ) : null}
    </main>
  );
}
