import { useStore } from "@querymodule/client";
import { visuallyHiddenStyle } from "@querymodule/web-ui";
import { useEffect, useId, useRef } from "react";
import { Link, Navigate, NavLink, useOutlet } from "react-router";
import { useCachedConfig } from "../app/cached-config.js";
import { useT } from "../app/i18n-context.js";
import { MAIN_LANDMARK } from "../app/main-landmark.js";
import { useServices } from "../app/services-context.js";
import { ConfigBuilder } from "./ConfigBuilder.js";
import { adminConfigOff, adminUsersOff, canManageUsers, canOpenAdmin } from "./roles.js";
import { UsersView } from "./Users.js";

/**
 * The admin console (ADR-0011 item 5, Task 30), lazy-loaded. Other roles get what an unknown path
 * gets: the query panel, so the console is not advertised.
 */
export function AdminLayout() {
  const { authStore } = useServices();
  const t = useT();
  const role = useStore(authStore, (s) => s.user?.role);
  const features = useCachedConfig()?.features;
  // AC-2: role and the published flag. Only a loaded config with the flag off closes the console.
  const allowed = canOpenAdmin(role) && !adminConfigOff(features);
  // Every console route opens a section (/admin redirects to Config) and the section focuses its
  // own heading (SectionHeading); the console title never takes focus, so the two cannot race (#388).
  const outlet = useOutlet();
  if (!allowed) return <Navigate to="/" replace />;
  // The console title stays for the outline but is visually hidden: the section heading is the
  // visible title (design target 09-29-26).
  return (
    <main className="qm-admin" {...MAIN_LANDMARK}>
      <h1 style={visuallyHiddenStyle}>{t("admin.title")}</h1>
      <AdminRail users={canManageUsers(role) && !adminUsersOff(features)} />
      <div className="qm-admin__main">{outlet}</div>
    </main>
  );
}

/**
 * The admin rail (design target, A1): the way back first, then the sections by group. The audit
 * log is listed but not yet built (M2): aria-disabled keeps it focusable with its reason (spec 6.2).
 */
function AdminRail({ users }: { users: boolean }) {
  const t = useT();
  const uid = useId();
  return (
    <nav className="qm-admin__rail" aria-label={t("admin.navLabel")}>
      <Link className="qm-admin__back" to="/">
        {t("admin.nav.back")}
      </Link>
      <div className="qm-admin__section">
        <p className="qm-admin__group" id={`${uid}-configure`}>
          {t("admin.nav.configure")}
        </p>
        <ul aria-labelledby={`${uid}-configure`}>
          <li>
            <NavLink to="/admin/config">{t("admin.nav.config")}</NavLink>
          </li>
        </ul>
      </div>
      {users && (
        <div className="qm-admin__section">
          <p className="qm-admin__group" id={`${uid}-people`}>
            {t("admin.nav.people")}
          </p>
          <ul aria-labelledby={`${uid}-people`}>
            <li>
              <NavLink to="/admin/users">{t("admin.nav.users")}</NavLink>
            </li>
            <li>
              <button type="button" aria-disabled="true" aria-describedby={`${uid}-audit`}>
                {t("admin.nav.audit")}
              </button>
              <span className="qm-admin__soon" id={`${uid}-audit`}>
                {t("admin.nav.auditPending")}
              </span>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}

/** A section heading that takes focus when the section opens (spec 6.4 focus on navigation). */
export function SectionHeading({ children }: { children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h2 ref={ref} tabIndex={-1}>
      {children}
    </h2>
  );
}

export function AdminConfigPage() {
  const t = useT();
  return (
    <section className="qm-builder">
      <SectionHeading>{t("admin.config.title")}</SectionHeading>
      <ConfigBuilder />
    </section>
  );
}

/** Users (Task 34): admin only; an implementer is sent to Config. */
export function AdminUsersPage() {
  const { authStore } = useServices();
  const t = useT();
  const role = useStore(authStore, (s) => s.user?.role);
  const features = useCachedConfig()?.features;
  if (!canManageUsers(role) || adminUsersOff(features))
    return <Navigate to="/admin/config" replace />;
  return (
    <section className="qm-users-page">
      <SectionHeading>{t("admin.users.title")}</SectionHeading>
      <UsersView />
    </section>
  );
}
