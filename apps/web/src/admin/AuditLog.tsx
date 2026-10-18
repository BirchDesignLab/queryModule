import { useStore } from "@querymodule/client";
import type { AdminAuditPage, AdminUser } from "@querymodule/core/contracts";
import { formatAckTime } from "@querymodule/web-ui";
import { useEffect, useId, useState } from "react";
import { Navigate } from "react-router";
import { useCachedConfig } from "../app/cached-config.js";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { SectionHeading } from "./AdminLayout.js";
import { AuditFilterForm } from "./AuditFilters.js";
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
  if (!canViewAudit(role) || adminAuditOff(features))
    return <Navigate to="/admin/config" replace />;
  return (
    <section className="qm-audit">
      <AuditLog usersPicker={features !== undefined && !adminUsersOff(features)} />
    </section>
  );
}

function freshForm(): AuditForm {
  return { user: "", correlationId: "", type: "", ...defaultWindow(Date.now()) };
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
  const [exportNote, setExportNote] = useState<{ kind: "info" | "error"; text: string } | null>(
    null,
  );

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only triggers a reload; `t` is stable per locale
  useEffect(() => {
    if (applied === null) return;
    let open = true;
    setLoading(true);
    setFailure(null);
    void fetchAuditPage(api, applied, cursor, pageSize).then((result) => {
      if (!open) return;
      setLoading(false);
      if ("kind" in result) {
        setFailure(result.kind);
        return;
      }
      setPage(result);
      // The count only, never a row's content (spec 6.6).
      announcer.announce(t("admin.audit.loaded", { count: result.events.length }));
    });
    return () => {
      open = false;
    };
  }, [api, announcer, applied, cursor, pageSize, attempt]);

  if (form === null) return <SectionHeading>{t("admin.audit.title")}</SectionHeading>;

  const apply = () => {
    const result = validateAuditForm(form);
    setErrors(result.errors);
    setExportNote(null);
    // A bad field sends nothing: the table keeps the last applied filters.
    if (result.filters !== null) store.set({ applied: result.filters, cursors: [undefined] });
  };
  const reset = () => {
    const next = freshForm();
    setErrors({});
    setExportNote(null);
    store.set({ form: next, applied: validateAuditForm(next).filters, cursors: [undefined] });
  };
  const exportBlocked = Object.keys(errors).length > 0;
  const runExport = async () => {
    if (applied === null || exportBlocked) return;
    setExportNote(null);
    const ok = await downloadAuditExport(api, applied);
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

  const exportId = `${uid}-export`;
  const fatal = failure === "forbidden" || failure === "notFound";
  return (
    <>
      <SectionHeading>{t("admin.audit.title")}</SectionHeading>
      <p className="qm-diff__note">{t("admin.audit.recorded")}</p>
      <AuditFilterForm
        form={form}
        errors={errors}
        users={usersPicker ? users : null}
        onChange={(patch) => store.set({ form: { ...form, ...patch } })}
        onApply={apply}
        onReset={reset}
      />
      <div className="qm-audit__export">
        <button
          type="button"
          className="qm-button qm-button--secondary"
          aria-disabled={exportBlocked || applied === null ? "true" : undefined}
          aria-describedby={exportId}
          onClick={runExport}
        >
          {t("admin.audit.export")}
        </button>
        <p id={exportId} className="qm-diff__note">
          {exportBlocked || applied === null
            ? t("admin.audit.exportBlocked")
            : t("admin.audit.exportUses", { summary: summarize(applied, t) })}
        </p>
        {exportNote !== null && (
          <p className="qm-builder__notice" role={exportNote.kind === "error" ? "alert" : "status"}>
            {exportNote.text}
          </p>
        )}
      </div>
      {failure !== null && (
        <div className="qm-builder__notice" role="alert">
          <span>
            {failure === "forbidden"
              ? t("admin.audit.error.forbidden")
              : failure === "notFound"
                ? t("admin.audit.error.notFound")
                : failure === "validation"
                  ? t("admin.audit.error.rejected")
                  : t("admin.audit.error.load")}
          </span>
          {!fatal && failure === "failed" && (
            <button type="button" className="qm-button" onClick={() => setAttempt((n) => n + 1)}>
              {t("admin.audit.error.retry")}
            </button>
          )}
        </div>
      )}
      {loading && page === null && (
        <p className="qm-diff__note" aria-busy="true" role="status">
          {t("admin.audit.loading")}
        </p>
      )}
      {!fatal && page !== null && applied !== null && (
        <>
          {page.events.length === 0 ? (
            <div className="qm-audit__empty">
              <p>{t("admin.audit.empty")}</p>
              <button type="button" className="qm-button qm-button--secondary" onClick={reset}>
                {t("admin.audit.reset")}
              </button>
            </div>
          ) : (
            <AuditTable
              rows={page.events}
              busy={loading}
              caption={t("admin.audit.caption", {
                from: formatAckTime(applied.from),
                to: formatAckTime(applied.to),
              })}
            />
          )}
          <div className="qm-audit__paging">
            <button
              type="button"
              className="qm-button qm-button--secondary"
              aria-disabled={loading || cursors.length < 2 ? "true" : undefined}
              onClick={newer}
            >
              {t("admin.audit.newer")}
            </button>
            <span>{t("admin.audit.page", { page: cursors.length })}</span>
            <button
              type="button"
              className="qm-button qm-button--secondary"
              aria-disabled={loading || page.nextCursor === null ? "true" : undefined}
              onClick={older}
            >
              {t("admin.audit.older")}
            </button>
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
          </div>
        </>
      )}
    </>
  );
}

/** The applied filters in words, for the line under Export. */
function summarize(f: AuditFilters, t: ReturnType<typeof useT>): string {
  const parts = [
    t("admin.audit.summary.window", { from: formatAckTime(f.from), to: formatAckTime(f.to) }),
    ...(f.user === undefined ? [] : [t("admin.audit.summary.user", { user: f.user })]),
    ...(f.correlationId === undefined
      ? []
      : [t("admin.audit.summary.request", { request: f.correlationId })]),
    ...(f.type !== undefined && isAuditEventType(f.type)
      ? [t("admin.audit.summary.event", { event: t(`admin.audit.type.${f.type}`) })]
      : []),
  ];
  return parts.join(", ");
}
