import { useStore } from "@querymodule/client";
import { Navigate, Outlet } from "react-router";
import { useClientSupported } from "./client-support-context.js";
import { useServices } from "./services-context.js";
import { UpdateRequiredPage } from "./UpdateRequiredPage.js";

export function RequireAuth() {
  const { authStore } = useServices();
  const status = useStore(authStore, (s) => s.status);
  const clientSupported = useClientSupported();
  if (status !== "signedIn") return <Navigate to="/login" replace />;
  if (!clientSupported) return <UpdateRequiredPage />;
  return <Outlet />;
}
