import { useStore } from "@querymodule/client";
import { Navigate, Outlet } from "react-router";
import { ChangePasswordPage } from "./ChangePasswordPage.js";
import { useClientSupported } from "./client-support-context.js";
import { useServices } from "./services-context.js";
import { UpdateRequiredPage } from "./UpdateRequiredPage.js";

export function RequireAuth() {
  const { authStore } = useServices();
  const status = useStore(authStore, (s) => s.status);
  const passwordChangeRequired = useStore(authStore, (s) => s.passwordChangeRequired);
  const clientSupported = useClientSupported();
  if (status !== "signedIn") return <Navigate to="/login" replace />;
  if (!clientSupported) return <UpdateRequiredPage />;
  // D-A26: nothing else renders (no header, no page, no socket) until the password is changed.
  if (passwordChangeRequired) return <ChangePasswordPage />;
  return <Outlet />;
}
