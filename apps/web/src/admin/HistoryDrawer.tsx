import type { ConfigVersion } from "@querymodule/core/contracts";
import { formatAckTime } from "@querymodule/web-ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { exportVersion, fetchVersions } from "./admin-config.js";
import { configDraftStore } from "./builder-store.js";
import { SCROLL_FOCUS } from "./scroll-focus.js";

/**
 * Version history (Task 33 part 2b, #358, BR-001, UX-004): a named region opened from the toolbar's
 * History button, drawn as mockup v6's 380 px drawer over the builder's end edge (D-M2P3-B1). It lists GET /admin/config/versions newest first, with a roll back on each
 * previous version (the confirm and the request are the publish flow's) and an export on each. Esc
 * closes it; the builder returns focus to the History button. Each published version shows its
 * publisher's name (the id when the server has none) and its change note, or "No note" (D-M2P0-4,
 * M2 P2 BW3). A roll back shows a Rollback tag and the system's own line, apart from a typed note.
 * Notes are plain text: React escapes them, nothing is rendered as markup.
 */

/** The heading takes focus when the region opens; it is not in the tab order. */
const PROGRAMMATIC_FOCUS = { tabIndex: -1 } as const;

const STATUS_BADGE = {
  published: "qm-badge qm-badge--ok",
  superseded: "qm-badge qm-badge--status",
  draft: "qm-badge qm-badge--info",
} as const;
const STATUS_TEXT = {
  published: "admin.history.status.published",
  superseded: "admin.history.status.superseded",
  draft: "admin.history.status.draft",
} as const;

/** How long the Blob URL outlives the click. */
export const REVOKE_DELAY_MS = 1000;

/** Hands the document to the browser as `<siteId>-v<n>.json`; the Blob URL is revoked after the click. */
function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Some engines drop the download if the URL goes at once: revoke it a moment later.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function HistoryDrawer({
  id,
  stamp,
  onClose,
  onLeave,
  onRollback,
}: {
  /** The region's id, named by the History button's aria-controls. */
  id: string;
  /** Changes whenever the list on the server did (a roll back, a publish): the list reloads. */
  stamp: number;
  onClose(): void;
  /** Focus left for the page (not for a dialog it opened): close without moving focus back. */
  onLeave(): void;
  onRollback(version: number): void;
}) {
  const t = useT();
  const services = useServices();
  const { api } = services;
  const store = configDraftStore(services);
  const headingId = useId();
  const regionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [versions, setVersions] = useState<ConfigVersion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [exportError, setExportError] = useState<number | null>(null);

  // `stamp` and `attempt` are the reload triggers: the list stays on screen while it reloads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the two counters only trigger the load
  useEffect(() => {
    let open = true;
    fetchVersions(api).then((list) => {
      if (!open) return;
      setFailed(list === null);
      if (list !== null) setVersions(list);
    });
    return () => {
      open = false;
    };
  }, [api, stamp, attempt]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Esc closes it, from anywhere inside (a native listener: the region is not a widget).
  useEffect(() => {
    const region = regionRef.current;
    if (region === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    region.addEventListener("keydown", onKey);
    return () => region.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The drawer lies over the builder's end edge, so it never stays open behind the focus: when focus
  // moves to the page (Tab out, a click in the panes) it closes and focus stays where it went
  // (WCAG 2.4.11). A dialog it opens (roll back) keeps it open.
  useEffect(() => {
    const region = regionRef.current;
    if (region === null) return;
    const onOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      if (!(next instanceof Element) || region.contains(next)) return;
      if (next.closest('[role="dialog"], dialog') !== null) return;
      onLeave();
    };
    region.addEventListener("focusout", onOut);
    return () => region.removeEventListener("focusout", onOut);
  }, [onLeave]);

  // One export per version at a time: a second click on a version whose export is in flight
  // downloads nothing twice. An export of another version is its own request and goes ahead, so
  // no click is dropped without a trace.
  const exporting = useRef(new Set<number>());
  const doExport = useCallback(
    async (version: number) => {
      if (exporting.current.has(version)) return;
      exporting.current.add(version);
      try {
        setExportError(null);
        const doc = await exportVersion(api, version);
        const siteId = store.getState().server?.siteId;
        if (doc === null || siteId === undefined) {
          setExportError(version);
          return;
        }
        download(JSON.stringify(doc, null, 2), `${siteId}-v${version}.json`);
      } finally {
        exporting.current.delete(version);
      }
    },
    [api, store],
  );

  return (
    <section
      ref={regionRef}
      id={id}
      className="qm-history qm-history--drawer"
      aria-labelledby={headingId}
    >
      <div className="qm-history__head">
        <h3 ref={headingRef} className="qm-editor__title" id={headingId} {...PROGRAMMATIC_FOCUS}>
          {t("admin.history.title")}
        </h3>
        <button type="button" className="qm-button qm-button--secondary" onClick={onClose}>
          {t("admin.history.close")}
        </button>
      </div>
      <p className="qm-diff__note">{t("admin.history.hint")}</p>
      {exportError !== null && (
        <p className="qm-builder__notice" role="alert">
          {t("admin.history.exportFailed", { version: exportError })}
        </p>
      )}
      {failed && (
        <div className="qm-builder__notice" role="alert">
          <span>{t("admin.history.error")}</span>
          <button type="button" className="qm-button" onClick={() => setAttempt((n) => n + 1)}>
            {t("admin.history.retry")}
          </button>
        </div>
      )}
      {versions === null ? (
        !failed && (
          <p className="qm-diff__note" aria-busy="true">
            {t("admin.history.loading")}
          </p>
        )
      ) : versions.length === 0 ? (
        <p className="qm-diff__note">{t("admin.history.empty")}</p>
      ) : (
        <section
          className="qm-history__scroll"
          aria-label={t("admin.history.list")}
          {...SCROLL_FOCUS}
        >
          <ul className="qm-history__list">
            {versions.map((v) => {
              const at = v.status === "draft" ? v.createdAt : (v.publishedAt ?? v.createdAt);
              return (
                <li key={v.version} className="qm-history__row">
                  <span className="qm-history__version">
                    {t("admin.history.version", { version: v.version })}
                  </span>
                  <span className={STATUS_BADGE[v.status]}>{t(STATUS_TEXT[v.status])}</span>
                  <span className="qm-history__when">
                    {t(v.status === "draft" ? "admin.history.created" : "admin.history.published")}{" "}
                    <time dateTime={new Date(at).toISOString()}>{formatAckTime(at)}</time>
                  </span>
                  {v.status !== "draft" && (
                    <span className="qm-history__by">
                      {v.publishedByName !== undefined ? (
                        t("admin.history.by", { name: v.publishedByName })
                      ) : (
                        <>
                          {t("admin.history.byLead")}{" "}
                          <span className="qm-history__id">{v.publishedBy}</span>{" "}
                          {t("admin.history.nameMissing")}
                        </>
                      )}
                    </span>
                  )}
                  {v.status !== "draft" &&
                    (v.rollbackOf !== null ? (
                      <span className="qm-history__note">
                        <span className="qm-badge qm-badge--status">
                          {t("admin.history.rollbackTag")}
                        </span>{" "}
                        {t("admin.history.rollbackOf", { version: v.rollbackOf })}
                      </span>
                    ) : (
                      <span className="qm-history__note">
                        {v.note ?? (
                          <span className="qm-history__none">{t("admin.history.noNote")}</span>
                        )}
                      </span>
                    ))}
                  <span className="qm-history__actions">
                    {/* No roll back on the live version or a draft: the button is not there at all. */}
                    {v.status === "superseded" && (
                      <button
                        type="button"
                        className="qm-button qm-button--secondary"
                        aria-label={t("admin.history.rollbackLabel", { version: v.version })}
                        onClick={() => onRollback(v.version)}
                      >
                        {t("admin.history.rollback")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="qm-button qm-button--secondary"
                      aria-label={t("admin.history.exportLabel", { version: v.version })}
                      onClick={() => void doExport(v.version)}
                    >
                      {t("admin.history.export")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}
