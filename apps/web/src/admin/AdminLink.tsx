import { useStore } from "@querymodule/client";
import { NavLink } from "react-router";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { canOpenAdmin } from "./roles.js";

/** The header's Admin link: admin and implementer only (Task 30; one slot in AppHeader, D-A28). */
export function AdminLink() {
  const { authStore } = useServices();
  const t = useT();
  const role = useStore(authStore, (s) => s.user?.role);
  if (!canOpenAdmin(role)) return null;
  return (
    <NavLink className="qm-app-header__link" to="/admin">
      {t("admin.link")}
    </NavLink>
  );
}
