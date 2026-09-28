import { useStore } from "@querymodule/client";
import { Navigate, Outlet } from "react-router";
import { useServices } from "./services-context.js";

export function RequireAuth() {
  const { authStore } = useServices();
  const status = useStore(authStore, (s) => s.status);
  if (status !== "signedIn") return <Navigate to="/login" replace />;
  return <Outlet />;
}
