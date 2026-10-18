import { useStore } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import type { AdminQueryDetail } from "@querymodule/core/contracts";
import { formatAckTime, shortReference } from "@querymodule/web-ui";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { useResolvedPersona } from "../app/AppChrome.js";
import { useCachedConfig } from "../app/cached-config.js";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { sourceWhy } from "../query/result-view.js";
import { SourceCard } from "../query/SourceCard.js";
import { SectionHeading } from "./AdminLayout.js";
import { type AuditFetchError, fetchAdminQuery } from "./audit-api.js";
import { adminAuditOff, canViewAudit } from "./roles.js";

/** The stored values as the form holds them: a number is its text, as typed. */
function draftValuesOf(values: Part["values"]): Record<string, string | boolean | null> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      key,
      typeof value === "number" ? String(value) : value,
    ]),
  );
}

type Part = AdminQueryDetail["parts"][number];
type Load =
  | { status: "loading" }
  | { status: "ok"; detail: AdminQueryDetail }
  | { status: "error"; kind: AuditFetchError["kind"] };

/**
 * Admin request view (FR-063, SEC-012; spec 5.1, 6.2, 6.7): one request read only, as the query
 * screen draws it. Each open writes one `adminViewed` row on the server, so the request is fetched
 * once on open (and again only on Try again), never on focus or a timer. The payload lives in this
 * component's state and is gone when it unmounts. Nothing here edits, retries or hides.
 */
export function AdminRequestPage() {
  const { authStore } = useServices();
  const role = useStore(authStore, (s) => s.user?.role);
  const features = useCachedConfig()?.features;
  if (!canViewAudit(role) || adminAuditOff(features))
    return <Navigate to="/admin/config" replace />;
  return <AdminRequestView />;
}

function AdminRequestView() {
  const { api, announcer } = useServices();
  const t = useT();
  const persona = useResolvedPersona();
  const config = useCachedConfig();
  const { correlationId = "" } = useParams();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reference = shortReference(correlationId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` only triggers a reload; `t` is stable per locale
  useEffect(() => {
    let open = true;
    setLoad({ status: "loading" });
    void fetchAdminQuery(api, correlationId, false).then((result) => {
      if (!open) return;
      if ("kind" in result) {
        setLoad({ status: "error", kind: result.kind });
        return;
      }
      setLoad({ status: "ok", detail: result });
      announcer.announce(t("admin.request.loaded", { reference }));
    });
    return () => {
      open = false;
    };
  }, [api, announcer, correlationId, attempt]);

  return (
    <section className="qm-request-view">
      <SectionHeading>{t("admin.request.title", { reference })}</SectionHeading>
      <p className="qm-builder__notice" role="note">
        {t("admin.request.recorded")}
      </p>
      <div className="qm-request-view__bar">
        <Link className="qm-button qm-button--secondary" to="/admin/audit">
          {t("admin.request.back")}
        </Link>
        {/* Hide arrives in M3: the control is shown so the gap is explained, not hidden. */}
        <label className="qm-request-view__hidden">
          <input
            type="checkbox"
            checked={false}
            readOnly
            aria-disabled="true"
            aria-describedby="qm-request-hidden-why"
          />
          {t("admin.request.hidden")}
        </label>
        <span id="qm-request-hidden-why" className="qm-diff__note">
          {t("admin.request.hiddenReason")}
        </span>
      </div>
      {load.status === "loading" && (
        <p className="qm-diff__note" aria-busy="true" role="status">
          {t("admin.request.loading")}
        </p>
      )}
      {load.status === "error" && (
        <div className="qm-builder__notice" role="alert">
          <span>
            {load.kind === "forbidden"
              ? t("admin.audit.error.forbidden")
              : load.kind === "notFound" || load.kind === "validation"
                ? t("admin.request.notFound")
                : t("admin.request.error")}
          </span>
          {load.kind === "failed" && (
            <button type="button" className="qm-button" onClick={() => setAttempt((n) => n + 1)}>
              {t("admin.request.retry")}
            </button>
          )}
        </div>
      )}
      {load.status === "ok" && config !== undefined && (
        <>
          <p className="qm-diff__note">
            {t("admin.request.submitted", { time: formatAckTime(load.detail.submittedAt) })}
          </p>
          {load.detail.parts.map((part) => (
            <PartView
              key={part.partId}
              part={part}
              config={config}
              persona={persona}
              reference={reference}
              primaryType={
                load.detail.parts.find((p) => p.parentPartId === null)?.queryType ?? part.queryType
              }
            />
          ))}
        </>
      )}
    </section>
  );
}

function PartView({
  part,
  config,
  persona,
  reference,
  primaryType,
}: {
  part: Part;
  config: ClientSiteConfig;
  persona: string;
  reference: string;
  primaryType: string;
}) {
  const t = useT();
  const typeLabel = (code: string): string => {
    const key = config.queryTypes.find((q) => q.code === code)?.labelKey;
    return key === undefined ? code : t(key);
  };
  const sourceLabel = (id: string): string => {
    const key = config.sources.find((s) => s.id === id)?.labelKey;
    return key === undefined ? t("sourceStatus.unlistedSource", { source: id }) : t(key);
  };
  const fields = config.queryTypes.find((q) => q.code === part.queryType)?.fields ?? [];
  const values = fields.flatMap((field) => {
    const value = part.values?.[field.key];
    return value === undefined || value === null || value === ""
      ? []
      : [{ key: field.key, label: t(field.labelKey), value: String(value) }];
  });
  const name = `${typeLabel(part.queryType)} ${reference}`;
  return (
    <section className="qm-request-view__part" aria-label={name}>
      <h3>
        {part.parentPartId === null
          ? typeLabel(part.queryType)
          : t("sourceStatus.alsoRun", {
              queryType: typeLabel(part.queryType),
              from: typeLabel(primaryType),
            })}
      </h3>
      {values.length > 0 && (
        <dl className="qm-request-view__values" aria-label={t("admin.request.values")}>
          {values.map((v) => (
            <div key={v.key}>
              <dt className="qm-request-view__key">{v.label}</dt>
              <dd className="qm-request-view__value">{v.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul
        className="qm-request-view__sources"
        aria-label={t("admin.request.source", { queryType: typeLabel(part.queryType) })}
      >
        {part.sources.map((source) => {
          const why = sourceWhy(source.status, config, source.sourceId, t);
          return (
            <li key={source.sourceId}>
              <p>
                {t("sourceStatus.line", {
                  source: sourceLabel(source.sourceId),
                  status: t(`sourceStatus.status.${source.status}`),
                })}
                {why === undefined ? null : ` (${why})`}
              </p>
              {source.status === "returned" && source.payload !== undefined && (
                <SourceCard
                  config={config}
                  submitted={
                    part.parentPartId === null
                      ? {
                          queryType: part.queryType,
                          values: draftValuesOf(part.values),
                          sourceIds: [source.sourceId],
                          mode: "normal",
                        }
                      : undefined
                  }
                  queryType={part.queryType}
                  parentPartId={part.parentPartId}
                  partValues={part.values}
                  sourceId={source.sourceId}
                  payload={source.payload}
                  persona={persona}
                  sourceName={sourceLabel(source.sourceId)}
                  requestName={name}
                  t={t}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
