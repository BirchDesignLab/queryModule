import { useStore } from "@querymodule/client";
import type { ClientSiteConfig } from "@querymodule/core/config";
import type { AdminQueryDetail } from "@querymodule/core/contracts";
import { assessResult } from "@querymodule/core/response";
import {
  PurgedResultCard,
  RequestList,
  type RequestPartView,
  type RequestRowView,
  SeverityBadge,
  type SourceLineView,
  shortReference,
} from "@querymodule/web-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useResolvedPersona } from "../app/AppChrome.js";
import { useCachedConfig } from "../app/cached-config.js";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import {
  highestSeverity,
  purgedValuesSummary,
  sourcesDoneLine,
  sourceWhy,
} from "../query/result-view.js";
import { rowSummary } from "../query/row-summary.js";
import { SourceCard } from "../query/SourceCard.js";
import { SectionHeading } from "./AdminLayout.js";
import { AuditNoAccess, StateBox } from "./AuditStates.js";
import { type AuditFetchError, fetchAdminQuery } from "./audit-api.js";
import { adminAuditOff, canViewAudit } from "./roles.js";

type Part = AdminQueryDetail["parts"][number];
type Load =
  | { status: "loading" }
  | { status: "ok"; detail: AdminQueryDetail }
  | { status: "error"; kind: AuditFetchError["kind"] };
type T = ReturnType<typeof useT>;

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
  const t = useT();
  // Nothing is fetched until the site config says the feature is on: each open is an audit row.
  if (features === undefined) return <SectionHeading>{t("admin.audit.title")}</SectionHeading>;
  if (!canViewAudit(role)) return <AuditNoAccess kind="forbidden" />;
  if (adminAuditOff(features)) return <AuditNoAccess kind="off" />;
  return <AdminRequestView />;
}

/** The stored values as the form holds them: a number is its text, as typed. */
function draftValuesOf(values: Part["values"]): Record<string, string | boolean | null> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([key, value]) => [
      key,
      typeof value === "number" ? String(value) : value,
    ]),
  );
}

/** One request as a row of the shared request list: the entry head, its meta and every card. */
function adminRow(
  detail: AdminQueryDetail,
  config: ClientSiteConfig,
  persona: string,
  t: T,
): RequestRowView {
  const label = (key: string | undefined, fallback: string): string =>
    key === undefined ? fallback : t(key);
  const typeLabel = (code: string): string =>
    label(config.queryTypes.find((q) => q.code === code)?.labelKey, code);
  const sourceLabel = (id: string): string => {
    const key = config.sources.find((s) => s.id === id)?.labelKey;
    return key === undefined ? t("sourceStatus.unlistedSource", { source: id }) : t(key);
  };
  const primary = detail.parts.find((p) => p.parentPartId === null) ?? detail.parts[0];
  const primaryType = primary?.queryType ?? "";
  const reference = shortReference(detail.correlationId);
  const name = `${typeLabel(primaryType)} ${reference}`;
  const assessed = detail.parts.flatMap((part) =>
    part.sources.flatMap((source) =>
      source.status === "returned" && source.payload !== undefined
        ? [
            {
              partId: part.partId,
              sourceId: source.sourceId,
              assessment: assessResult(source.payload, config.keywords),
            },
          ]
        : [],
    ),
  );
  const highest = highestSeverity(assessed);
  // Retention took the values (spec 5.5): the type values are all that is left to show.
  const valuesPurged = primary?.purged === true;
  const statusLine = sourcesDoneLine(
    detail.parts.flatMap((part) => part.sources),
    t,
  );
  return {
    id: detail.correlationId,
    status: "acknowledged",
    typeLabel: typeLabel(primaryType),
    summary: valuesPurged
      ? purgedValuesSummary(primary?.typeValues)
      : rowSummary(config, primaryType, "", primary?.values, Date.now()),
    ...(valuesPurged ? { purgedValuesText: t("requests.purgedValues") } : {}),
    ...(statusLine === "" ? {} : { statusLine }),
    name,
    reference: detail.correlationId,
    acknowledgedAt: detail.submittedAt,
    notes: [],
    ...(highest === null
      ? {}
      : {
          severityBadge: (
            <SeverityBadge
              severity={highest.severity}
              styles={config.keywordSeverityStyles}
              t={t}
            />
          ),
        }),
    parts: detail.parts.map((part): RequestPartView => {
      const key = `${detail.correlationId}:${part.partId}`;
      return {
        key,
        ...(part.parentPartId === null
          ? {}
          : {
              label: t("sourceStatus.alsoRun", {
                queryType: typeLabel(part.queryType),
                from: typeLabel(primaryType),
              }),
            }),
        lines: [
          ...part.sources.map((source): SourceLineView => {
            const why = sourceWhy(source.status, config, source.sourceId, t);
            return {
              key: `${key}:${source.sourceId}`,
              tone:
                source.status === "pending"
                  ? "pending"
                  : source.status === "returned"
                    ? "ok"
                    : "problem",
              ...(why === undefined ? {} : { why }),
              text: t("sourceStatus.line", {
                source: sourceLabel(source.sourceId),
                status: t(`sourceStatus.status.${source.status}`),
              }),
              ...(source.status === "returned" && source.purged
                ? {
                    card: (
                      <PurgedResultCard
                        heading={sourceLabel(source.sourceId)}
                        status={t("sourceStatus.status.returned")}
                        headingLevel={part.parentPartId === null ? 4 : 5}
                        t={t}
                      />
                    ),
                  }
                : {}),
              ...(source.status === "returned" && source.payload !== undefined
                ? {
                    card: (
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
                    ),
                  }
                : {}),
            };
          }),
          ...part.droppedSourceIds.map(
            (sourceId): SourceLineView => ({
              key: `${key}:${sourceId}:notRun`,
              tone: "notRun",
              text: t("sourceStatus.notRun", { source: sourceLabel(sourceId) }),
            }),
          ),
        ],
      };
    }),
  };
}

function AdminRequestView() {
  const { api, announcer } = useServices();
  const t = useT();
  const persona = useResolvedPersona();
  const config = useCachedConfig();
  const { correlationId = "" } = useParams();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const lastFetch = useRef<string | null>(null);
  const reference = shortReference(correlationId);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One GET per open, because each one writes an `adminViewed` row: a re-run of the same id and
  // attempt (a StrictMode effect pass) sends nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `t` is stable per locale
  useEffect(() => {
    const key = `${correlationId}:${attempt}`;
    if (lastFetch.current === key) return;
    lastFetch.current = key;
    setLoad({ status: "loading" });
    void fetchAdminQuery(api, correlationId, false).then((result) => {
      if (!mounted.current || lastFetch.current !== key) return;
      if ("kind" in result) {
        setLoad({ status: "error", kind: result.kind });
        return;
      }
      setLoad({ status: "ok", detail: result });
      announcer.announce(t("admin.request.loaded", { reference }));
    });
  }, [api, announcer, correlationId, attempt, reference]);

  const detail = load.status === "ok" ? load.detail : null;
  const row = useMemo(
    () => (detail === null || config === undefined ? null : adminRow(detail, config, persona, t)),
    [detail, config, persona, t],
  );
  const primaryType = detail?.parts.find((p) => p.parentPartId === null)?.queryType ?? "";
  const typeKey = config?.queryTypes.find((q) => q.code === primaryType)?.labelKey;
  const typeName = typeKey === undefined ? primaryType : t(typeKey);

  // A request that is missing or not visible writes nothing, so the page says nothing about being
  // recorded and offers only the way back (design v6).
  const missing =
    load.status === "error" &&
    (load.kind === "notFound" || load.kind === "validation" || load.kind === "forbidden");
  const resultsRef = useRef<HTMLDivElement>(null);
  const retry = () => {
    setAttempt((n) => n + 1);
    // The retry button leaves with the error: focus goes to the results region.
    queueMicrotask(() => resultsRef.current?.focus());
  };

  const back = (
    <Link className="qm-button qm-button--secondary" to="/admin/audit">
      {t("admin.request.back")}
    </Link>
  );
  return (
    <section className="qm-request-view">
      <nav className="qm-request-view__crumbs" aria-label={t("admin.request.crumbs")}>
        <Link to="/admin/audit">{t("admin.audit.title")}</Link>
        <span aria-hidden="true"> / </span>
        <span>{t("admin.request.title", { reference })}</span>
      </nav>
      <div>
        <SectionHeading>{t("admin.request.title", { reference })}</SectionHeading>
        {detail !== null && (
          <p className="qm-diff__note">{t("admin.request.intro", { type: typeName })}</p>
        )}
      </div>
      {!missing && (
        <>
          <div className="qm-request-view__banner" role="note">
            <b>{t("admin.request.recorded")}</b>
            <span className="qm-diff__note">{t("admin.request.recordedHint")}</span>
          </div>
          <div className="qm-request-view__bar">
            {back}
            <span className="qm-diff__note">{t("admin.request.filtersKept")}</span>
            {/* Hide arrives in M3: the control is shown so the gap is explained, not hidden. */}
            <label className="qm-request-view__hidden">
              <input
                type="checkbox"
                checked={false}
                readOnly
                aria-disabled="true"
                aria-describedby="qm-request-hidden-why"
                onClick={(e) => e.preventDefault()}
                onKeyDown={(e) => {
                  if (e.key === " ") e.preventDefault();
                }}
              />
              {t("admin.request.hidden")}
            </label>
            <span id="qm-request-hidden-why" className="qm-diff__note">
              {t("admin.request.hiddenReason")}
            </span>
          </div>
        </>
      )}
      <div ref={resultsRef} tabIndex={-1} className="qm-request-view__results">
        {load.status === "loading" && (
          <p className="qm-diff__note" aria-busy="true" role="status">
            {t("admin.request.loading")}
          </p>
        )}
        {load.status === "error" &&
          (load.kind === "notFound" || load.kind === "validation" ? (
            <StateBox
              title={t("admin.request.notFound.title")}
              body={t("admin.request.notFound.body")}
            >
              {back}
            </StateBox>
          ) : load.kind === "forbidden" ? (
            <StateBox
              alert
              title={t("admin.audit.noAccess.title")}
              body={t("admin.audit.noAccess.body")}
            />
          ) : (
            <StateBox
              alert
              title={t("admin.request.failed.title")}
              body={t("admin.request.failed.body")}
            >
              <button type="button" className="qm-button" onClick={retry}>
                {t("admin.audit.retry")}
              </button>
            </StateBox>
          ))}
        {row !== null && (
          <RequestList
            rows={[row]}
            heading={t("admin.request.list")}
            headingLevel={null}
            emptyText=""
            t={t}
            onCopy={(id) => {
              // A failed copy stays silent: the ID is on screen.
              void navigator.clipboard?.writeText(id).then(
                () => announcer.announce(t("submit.referenceCopied")),
                () => undefined,
              );
            }}
          />
        )}
      </div>
    </section>
  );
}
