import { LineIcon, type LineIconName } from "@querymodule/web-ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useT } from "../app/i18n-context.js";
import { SectionHeading } from "./AdminLayout.js";

/** A state box (design v6): a heading and one sentence, with an action. Errors are alerts. */
export function StateBox({
  title,
  body,
  alert = false,
  icon = alert ? "error" : "log",
  children,
}: {
  title: string;
  body: string;
  alert?: boolean;
  /** v6's icon over the heading: an error circle for an alert, the log page otherwise. */
  icon?: LineIconName;
  children?: ReactNode;
}) {
  return (
    <div
      className={alert ? "qm-audit__state qm-audit__state--error" : "qm-audit__state"}
      role={alert ? "alert" : undefined}
    >
      <LineIcon name={icon} />
      <h3>{title}</h3>
      <p>{body}</p>
      {children}
    </div>
  );
}

/**
 * The full-page states for the audit log and the request view (design v6): 403 for a role that may
 * not read it (an implementer, or any other), 404 when the site has not turned it on. Nothing is
 * fetched, so nothing is recorded.
 */
export function AuditNoAccess({ kind }: { kind: "forbidden" | "off" }) {
  const t = useT();
  return (
    <section className="qm-audit">
      <SectionHeading>{t("admin.audit.title")}</SectionHeading>
      {kind === "forbidden" ? (
        <StateBox
          alert
          icon="lock"
          title={t("admin.audit.noAccess.title")}
          body={t("admin.audit.noAccess.body")}
        >
          <Link className="qm-button qm-button--secondary" to="/admin/config">
            {t("admin.audit.noAccess.action")}
          </Link>
        </StateBox>
      ) : (
        <StateBox title={t("admin.audit.notOn.title")} body={t("admin.audit.notOn.body")}>
          <Link className="qm-button qm-button--secondary" to="/">
            {t("admin.audit.notOn.action")}
          </Link>
        </StateBox>
      )}
    </section>
  );
}
