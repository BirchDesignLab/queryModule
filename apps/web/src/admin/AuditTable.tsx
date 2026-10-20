import type { AuditReadRow } from "@querymodule/core/contracts";
import { formatAckTime, shortReference, VisuallyHidden } from "@querymodule/web-ui";
import { Link } from "react-router";
import { useT } from "../app/i18n-context.js";
import { auditDetailRows, isAuditEventType } from "./audit-model.js";
import { SCROLL_FOCUS } from "./scroll-focus.js";

/**
 * One page of audit rows as a real table (spec 6.2 admin audit viewer). Details are a native
 * disclosure listing the stored keys and values: identifiers and metadata only (spec 5.5), as the
 * server stored them, never interpreted. An unknown stored type shows its raw name (the read
 * schema is tolerant). Below the admin section width the credential owner folds under the actor.
 */
export function AuditTable({
  rows,
  caption,
  busy,
  onOpenRequest,
}: {
  rows: readonly AuditReadRow[];
  caption: string;
  busy: boolean;
  /** A request link was used: the page remembers it so Back can return focus to it. */
  onOpenRequest(correlationId: string): void;
}) {
  const t = useT();
  const none = t("admin.audit.none");
  return (
    <section
      className="qm-audit__scroll"
      aria-label={t("admin.audit.table")}
      aria-busy={busy ? "true" : undefined}
      {...SCROLL_FOCUS}
    >
      <table className="qm-audit__table">
        <caption className="qm-audit__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="qm-audit__cell qm-audit__head">
              {t("admin.audit.col.time")}
            </th>
            <th scope="col" className="qm-audit__cell qm-audit__head">
              {t("admin.audit.col.event")}
            </th>
            <th scope="col" className="qm-audit__cell qm-audit__head">
              {t("admin.audit.col.actor")}
            </th>
            <th scope="col" className="qm-audit__cell qm-audit__head">
              {t("admin.audit.col.request")}
            </th>
            <th scope="col" className="qm-audit__cell qm-audit__head qm-audit__owner">
              {t("admin.audit.col.credentialOwner")}
            </th>
            <th scope="col" className="qm-audit__cell qm-audit__head">
              {t("admin.audit.col.details")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const details = auditDetailRows(row.details);
            const eventLabel = isAuditEventType(row.type)
              ? t(`admin.audit.type.${row.type}`)
              : row.type;
            return (
              <tr key={row.id}>
                <td className="qm-audit__cell">
                  <time className="qm-audit__time" dateTime={new Date(row.at).toISOString()}>
                    {formatAckTime(row.at)}
                  </time>
                </td>
                <td className="qm-audit__cell qm-audit__event">{eventLabel}</td>
                <td className="qm-audit__cell">
                  <span>{row.actor.email ?? t("admin.audit.system")}</span>
                  <div>
                    <span className="qm-badge qm-audit__role">{roleLabel(row.actor.role, t)}</span>
                  </div>
                  {row.credentialUserId !== undefined && (
                    <span className="qm-audit__fold">
                      {t("admin.audit.credentials", { owner: row.credentialUserId })}
                    </span>
                  )}
                </td>
                <td className="qm-audit__cell">
                  {row.correlationId === undefined ? (
                    none
                  ) : (
                    <Link
                      className="qm-audit__request"
                      to={`/admin/queries/${row.correlationId}`}
                      data-request-id={row.correlationId}
                      onClick={() => onOpenRequest(row.correlationId as string)}
                    >
                      {shortReference(row.correlationId)}
                      <VisuallyHidden>{t("admin.audit.openRequest")}</VisuallyHidden>
                    </Link>
                  )}
                </td>
                <td className="qm-audit__cell qm-audit__owner qm-audit__mono">
                  {row.credentialUserId ?? none}
                </td>
                <td className="qm-audit__cell">
                  {details.length === 0 ? (
                    t("admin.audit.noDetails")
                  ) : (
                    <details className="qm-audit__details">
                      <summary>
                        {t("admin.audit.details", { count: details.length })}{" "}
                        <VisuallyHidden>
                          {t("admin.audit.detailsFor", {
                            event: eventLabel,
                            time: formatAckTime(row.at),
                          })}
                        </VisuallyHidden>
                      </summary>
                      <dl className="qm-audit__list">
                        {details.map((d) => (
                          <div key={d.key}>
                            <dt className="qm-audit__key">{d.key}</dt>
                            <dd className="qm-audit__value">{d.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const KNOWN_ROLES = ["user", "trainingOfficer", "admin", "implementer"];

function roleLabel(role: string, t: ReturnType<typeof useT>): string {
  return KNOWN_ROLES.includes(role) ? t(`role.${role}`) : role;
}
