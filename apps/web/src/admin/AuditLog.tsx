import { useStore } from "@querymodule/client";
import type { AdminAuditPage, AdminUser } from "@querymodule/core/contracts";
import { VisuallyHidden } from "@querymodule/web-ui";
import { useEffect, useId, useRef, useState } from "react";
import { useCachedConfig } from "../app/cached-config.js";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { SectionHeading } from "./AdminLayout.js";
import { AuditFilterForm } from "./AuditFilters.js";
import { AuditNoAccess, StateBox } from "./AuditStates.js";
import { AuditTable } from "./AuditTable.js";
import {
  type AuditFetchError,
  type AuditFilters,
  downloadAuditExport,
  fetchAuditPage,
} from "./audit-api.js";
import {
  type AuditForm,
  type AuditFormErrors,
  defaultWindow,
  formatWindowTime,
  isAuditEventType,
  validateAuditForm,
} from "./audit-model.js";
import { AUDIT_PAGE_SIZES, useAuditView } from "./audit-store.js";
import { adminAuditOff, adminUsersOff, canViewAudit } from "./roles.js";
import { fetchUsers } from "./users-api.js";

/**
 * Audit log (spec 6.2 admin audit viewer, FR-064, SEC-012): admin only, behind `adminAudit`. Every
 * fetch writes an `auditViewed` row on the server, so a fetch happens on open, on Apply, on paging,
 * on Rows per page and on Try again, and never on focus or a timer. Rows live in this component's
 * state and nowhere else (spec 6.7); the filters live in the in-memory audit store.
 */
export function AuditLogPage() {
  const { authStore } = useServices();
  const role = useStore(authStore, (s) => s.user?.role);
  const features = useCachedConfig()?.features;
  const t = useT();
  // Nothing is fetched until the site config says the feature is on: a fetch is an audit row.
  if (features === undefined) return <SectionHeading>{t("admin.audit.title")}</SectionHeading>;
  if (!canViewAudit(role)) return <AuditNoAccess kind="forbidden" />;
  if (adminAuditOff(features)) return <AuditNoAccess kind="off" />;
  return (
    <section className="qm-audit">
      <AuditLog usersPicker={!adminUsersOff(features)} />
    </section>
  );
}

function freshForm(): AuditForm {
  return { user: "", correlationId: "", type: "", ...defaultWindow(Date.now()) };
}

/** What a fetch was for: a re-run of the same state (a StrictMode effect pass) sends nothing. */
interface FetchKey {
  applied: AuditFilters;
  cursor: string | undefined;
  pageSize: number;
  attempt: number;
}

function AuditLog({ usersPicker }: { usersPicker: boolean }) {
  const { api, announcer } = useServices();
  const t = useT();
  const uid = useId();
  const { store, state } = useAuditView();
  const { form, applied, cursors, pageSize } = state;
  const cursor = cursors[cursors.length - 1];
  const [errors, setErrors] = useState<AuditFormErrors>({});
  const [page, setPage] = useState<AdminAuditPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<AuditFetchError["kind"] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ kind: "info" | "error"; text: string } | null>(
    null,
  );
  const resultsRef = useRef<HTMLDivElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const lastFetch = useRef<FetchKey | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // First open: the default window (the last 24 hours) is applied at once. Opening again (Back
  // from the request view) keeps the form and the applied filters from the store.
  useEffect(() => {
    if (store.getState().form !== null) return;
    const next = freshForm();
    store.set({ form: next, applied: validateAuditForm(next).filters, cursors: [undefined] });
  }, [store]);

  useEffect(() => {
    if (!usersPicker) return;
    let open = true;
    void fetchUsers(api).then((list) => {
      if (open) setUsers(list);
    });
    return () => {
      open = false;
    };
  }, [api, usersPicker]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `t` is stable per locale
  useEffect(() => {
    if (applied === null) return;
    const prior = lastFetch.current;
    if (
      prior !== null &&
      prior.applied === applied &&
      prior.cursor === cursor &&
      prior.pageSize === pageSize &&
      prior.attempt === attempt
    )
      return;
    const key: FetchKey = { applied, cursor, pageSize, attempt };
    lastFetch.current = key;
    setLoading(true);
    setFailure(null);
    void fetchAuditPage(api, applied, cursor, pageSize).then((result) => {
      if (!mounted.current || lastFetch.current !== key) return;
      setLoading(false);
      if ("kind" in result) {
        setFailure(result.kind);
        return;
      }
      setPage(result);
      // The count only, never a row's content (spec 6.6).
      announcer.announce(t("admin.audit.loaded", { count: result.events.length }));
    });
  }, [api, announcer, applied, cursor, pageSize, attempt]);

  // Back from the request view: focus returns to the request link that was used, once its row is
  // here. What the link left in the store is read once, when this page opens; a click on a link
  // here only leaves it for the next open.
  const returnTo = useRef<string | null>(store.getState().focusRequest);
  useEffect(() => {
    if (store.getState().focusRequest !== null) store.set({ focusRequest: null });
  }, [store]);
  useEffect(() => {
    const id = returnTo.current;
    if (id === null || page === null) return;
    const link = [...document.querySelectorAll<HTMLElement>("[data-request-id]")].find(
      (el) => el.dataset.requestId === id,
    );
    if (link === undefined) return;
    returnTo.current = null;
    link.focus();
  }, [page]);

  if (form === null) return <SectionHeading>{t("admin.audit.title")}</SectionHeading>;
  if (failure === "forbidden") return <AuditNoAccess kind="forbidden" />;
  if (failure === "notFound") return <AuditNoAccess kind="off" />;

  const apply = () => {
    const result = validateAuditForm(form);
    setErrors(result.errors);
    setExportNote(null);
    const fields = Object.keys(result.errors) as (keyof AuditFormErrors)[];
    const first = fields[0];
    if (first !== undefined) {
      // A bad field sends nothing: the table keeps the last applied filters. Focus goes to the
      // first bad field; the announcement is the count and its message, never typed content.
      announcer.announce(
        t("admin.audit.needAttention", {
          count: fields.length,
          message: t(result.errors[first] as string),
        }),
      );
      queueMicrotask(() => {
        document.querySelector<HTMLElement>('.qm-audit__form [aria-invalid="true"]')?.focus();
      });
      return;
    }
    if (result.filters !== null) store.set({ applied: result.filters, cursors: [undefined] });
  };
  const reset = (toResetButton: boolean) => {
    const next = freshForm();
    setErrors({});
    setExportNote(null);
    store.set({ form: next, applied: validateAuditForm(next).filters, cursors: [undefined] });
    // Reset stays on Reset: from the empty state's own button the focus moves to the form's.
    if (toResetButton) queueMicrotask(() => resetRef.current?.focus());
  };
  const exportBlocked = Object.keys(errors).length > 0 || applied === null;
  const runExport = async () => {
    if (applied === null || exportBlocked || exporting) return;
    setExporting(true);
    setExportNote(null);
    const ok = await downloadAuditExport(api, applied);
    if (!mounted.current) return;
    setExporting(false);
    setExportNote(
      ok
        ? { kind: "info", text: t("admin.audit.exported") }
        : { kind: "error", text: t("admin.audit.exportFailed") },
    );
  };
  const older = () => {
    if (loading || page?.nextCursor == null) return;
    store.set({ cursors: [...cursors, page.nextCursor] });
  };
  const newer = () => {
    if (loading || cursors.length < 2) return;
    store.set({ cursors: cursors.slice(0, -1) });
  };
  const retry = () => {
    setAttempt((n) => n + 1);
    // The retry button leaves with the error: focus goes to the results region (design v6).
    queueMicrotask(() => resultsRef.current?.focus());
  };

  const exportId = `${uid}-export`;
  const newestWhy = `${uid}-newest`;
  const oldestWhy = `${uid}-oldest`;
  const atNewest = cursors.length < 2;
  const atOldest = page?.nextCursor == null;
  return (
    <>
      <div className="qm-audit__toolbar">
        <SectionHeading>{t("admin.audit.title")}</SectionHeading>
        <span className="qm-audit__tag">{t("admin.audit.adminOnly")}</span>
        <span className="qm-audit__recorded">{t("admin.audit.recorded")}</span>
      </div>
      <AuditFilterForm
        form={form}
        errors={errors}
        users={usersPicker ? users : null}
        resetRef={resetRef}
        onChange={(patch) => store.set({ form: { ...form, ...patch } })}
        onApply={apply}
        onReset={() => reset(false)}
      >
        <span className="qm-audit__grow" />
        <button
          type="button"
          className="qm-button qm-button--secondary"
          aria-disabled={exportBlocked || exporting ? "true" : undefined}
          aria-describedby={exportId}
          onClick={runExport}
        >
          {t("admin.audit.export")}
        </button>
        <p id={exportId} className="qm-audit__export-line">
          {exportBlocked || applied === null
            ? t("admin.audit.exportBlocked")
            : t("admin.audit.exportUses", { summary: summarize(applied, t) })}
        </p>
      </AuditFilterForm>
      {exportNote !== null && (
        <p className="qm-builder__notice" role={exportNote.kind === "error" ? "alert" : "status"}>
          {exportNote.text}
        </p>
      )}
      <div ref={resultsRef} className="qm-audit__body" tabIndex={-1}>
        {failure === "validation" ? (
          <StateBox
            alert
            title={t("admin.audit.failed.title")}
            body={t("admin.audit.error.rejected")}
          />
        ) : failure === "failed" ? (
          <StateBox alert title={t("admin.audit.failed.title")} body={t("admin.audit.failed.body")}>
            <button type="button" className="qm-button" onClick={retry}>
              {t("admin.audit.retry")}
            </button>
          </StateBox>
        ) : null}
        {loading && page === null && failure === null && (
          <>
            <div className="qm-audit__skeleton" aria-busy="true">
              <i />
              <i />
              <i />
            </div>
            <p className="qm-audit__hint" role="status">
              {t("admin.audit.loading")}
            </p>
          </>
        )}
        {failure === null && page !== null && applied !== null && (
          <>
            {page.events.length === 0 ? (
              <StateBox title={t("admin.audit.empty.title")} body={t("admin.audit.empty.body")}>
                <button
                  type="button"
                  className="qm-button qm-button--secondary"
                  onClick={() => reset(true)}
                >
                  {t("admin.audit.resetFilters")}
                </button>
              </StateBox>
            ) : (
              <AuditTable
                rows={page.events}
                busy={loading}
                onOpenRequest={(id) => store.set({ focusRequest: id })}
                caption={t("admin.audit.caption", {
                  from: formatWindowTime(applied.from),
                  to: formatWindowTime(applied.to),
                })}
              />
            )}
            {(page.events.length > 0 || !atNewest) && (
              <nav className="qm-audit__pager" aria-label={t("admin.audit.pages")}>
                <span className="qm-audit__hint">
                  {t("admin.audit.count", { count: page.events.length })}
                </span>
                <div className="qm-field qm-audit__page-size">
                  <label htmlFor={`${uid}-size`} className="qm-field__label">
                    {t("admin.audit.field.pageSize")}
                  </label>
                  <select
                    id={`${uid}-size`}
                    className="qm-select"
                    value={pageSize}
                    onChange={(e) =>
                      store.set({ pageSize: Number(e.currentTarget.value), cursors: [undefined] })
                    }
                  >
                    {AUDIT_PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="qm-button qm-button--secondary"
                  aria-disabled={loading || atNewest ? "true" : undefined}
                  aria-describedby={atNewest ? newestWhy : undefined}
                  onClick={newer}
                >
                  {t("admin.audit.newer")}
                </button>
                <button
                  type="button"
                  className="qm-button qm-button--secondary"
                  aria-disabled={loading || atOldest ? "true" : undefined}
                  aria-describedby={atOldest ? oldestWhy : undefined}
                  onClick={older}
                >
                  {t("admin.audit.older")}
                </button>
                <VisuallyHidden>
                  <span id={newestWhy}>{t("admin.audit.newestPage")}</span>
                  <span id={oldestWhy}>{t("admin.audit.oldestPage")}</span>
                </VisuallyHidden>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}

/** The applied filters in words, for the line under Export. */
function summarize(f: AuditFilters, t: ReturnType<typeof useT>): string {
  return [
    f.user === undefined
      ? t("admin.audit.summary.anyUser")
      : t("admin.audit.summary.user", { user: f.user }),
    f.type !== undefined && isAuditEventType(f.type)
      ? t(`admin.audit.type.${f.type}`).toLowerCase()
      : t("admin.audit.summary.anyEvent"),
    ...(f.correlationId === undefined ? [] : [t("admin.audit.summary.oneRequest")]),
    t("admin.audit.summary.window", {
      from: formatWindowTime(f.from),
      to: formatWindowTime(f.to),
    }),
  ].join(", ");
}
