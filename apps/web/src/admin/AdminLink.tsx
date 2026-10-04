import { useStore } from "@querymodule/client";
import { NavLink } from "react-router";
import { useCachedConfig } from "../app/cached-config.js";
import { useT } from "../app/i18n-context.js";
import { useServices } from "../app/services-context.js";
import { adminConfigOn, canOpenAdmin } from "./roles.js";

/** The header's Admin link: admin and implementer only, while adminConfig is on (Task 30; one slot in AppHeader, D-A28). */
export function AdminLink() {
  const { authStore } = useServices();
  const t = useT();
  const role = useStore(authStore, (s) => s.user?.role);
  const features = useCachedConfig()?.features;
  // Role and the adminConfig flag (AC-2): with the flag off every console call answers 404.
  if (!canOpenAdmin(role) || !adminConfigOn(features)) return null;
  return (
    <NavLink className="qm-app-header__link" to="/admin">
      {t("admin.link")}
    </NavLink>
  );
}
