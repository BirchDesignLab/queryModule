import type { ConfigVersion } from "@querymodule/core/contracts";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useT, useTranslator } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { exportVersion, fetchVersions } from "./admin-config.js";
import { configDraftStore } from "./builder-store.js";

/**
 * Version history (Task 33 part 2b, #358, BR-001, UX-004): a named region opened from the toolbar's
 * History button. It lists GET /admin/config/versions newest first, with a roll back on each
 * previous version (the confirm and the request are the publish flow's) and an export on each. Esc
 * closes it; the builder returns focus to the History button. The contract carries user ids and no
 * change note, so neither is shown in M1.
 */

/** A region that scrolls takes focus so the keyboard can scroll it (axe scrollable-region-focusable). */
const SCROLL_FOCUS = { tabIndex: 0 } as const;
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
const REVOKE_DELAY_MS = 1000;

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
  onRollback,
}: {
  /** The region's id, named by the History button's aria-controls. */
  id: string;
  /** Changes whenever the list on the server did (a roll back, a publish): the list reloads. */
  stamp: number;
  onClose(): void;
  onRollback(version: number): void;
}) {
  const t = useT();
  const { locale } = useTranslator();
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

  const time = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    [locale],
  );

  // One export at a time: a second click while one is in flight downloads nothing twice.
  const exporting = useRef(false);
  const doExport = useCallback(
    async (version: number) => {
      if (exporting.current) return;
      exporting.current = true;
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
        exporting.current = false;
      }
    },
    [api, store],
  );

  return (
    <section ref={regionRef} id={id} className="qm-history" aria-labelledby={headingId}>
      <div className="qm-history__head">
        <h3 ref={headingRef} className="qm-editor__title" id={headingId} {...PROGRAMMATIC_FOCUS}>
          {t("admin.history.title")}
        </h3>
        <button type="button" className="qm-button qm-button--secondary" onClick={onClose}>
          {t("admin.history.close")}
        </button>
      </div>
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
                    <time dateTime={new Date(at).toISOString()}>{time.format(at)}</time>
                  </span>
                  {v.rollbackOf !== null && (
                    <span className="qm-history__of">
                      {t("admin.history.rollbackOf", { version: v.rollbackOf })}
                    </span>
                  )}
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
