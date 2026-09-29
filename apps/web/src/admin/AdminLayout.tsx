import { useStore } from "@querymodule/client";
import { useEffect, useRef } from "react";
import { Link, Navigate, Outlet } from "react-router";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { ConfigBuilder } from "./ConfigBuilder.js";
import { canManageUsers, canOpenAdmin } from "./roles.js";

/**
 * The admin console (ADR-0011 item 5, Task 30), lazy-loaded. Other roles get what an unknown path
 * gets: the query panel, so the console is not advertised.
 */
export function AdminLayout() {
  const { authStore } = useServices();
  const t = useT();
  const role = useStore(authStore, (s) => s.user?.role);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const allowed = canOpenAdmin(role);
  useEffect(() => {
    if (allowed) headingRef.current?.focus();
  }, [allowed]);
  if (!allowed) return <Navigate to="/" replace />;
  return (
    <main className="qm-admin">
      <h1 ref={headingRef} tabIndex={-1}>
        {t("admin.title")}
      </h1>
      <nav aria-label={t("admin.navLabel")}>
        <ul className="qm-admin__nav">
          <li>
            <Link to="/admin/config">{t("admin.nav.config")}</Link>
          </li>
          {canManageUsers(role) && (
            <li>
              <Link to="/admin/users">{t("admin.nav.users")}</Link>
            </li>
          )}
        </ul>
      </nav>
      <Outlet />
    </main>
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
    <section>
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
  if (!canManageUsers(role)) return <Navigate to="/admin/config" replace />;
  return (
    <section>
      <SectionHeading>{t("admin.users.title")}</SectionHeading>
      <p>{t("admin.users.pending")}</p>
    </section>
  );
}
