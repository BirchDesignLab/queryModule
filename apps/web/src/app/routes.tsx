import { Navigate, type RouteObject } from "react-router";
import { LoginPage } from "../login/LoginPage.js";
import { QueryPanel } from "../query/QueryPanel.js";
import { StatusPage } from "../status/StatusPage.js";
import { AppShell } from "./AppChrome.js";
import { RequireAuth } from "./RequireAuth.js";

export function appRoutes(clientSupported: boolean): RouteObject[] {
  return [
    { path: "/login", element: <LoginPage clientSupported={clientSupported} /> },
    {
      element: <RequireAuth />,
      children: [
        {
          element: <AppShell />,
          children: [
            { path: "/", element: <QueryPanel /> },
            { path: "/status", element: <StatusPage /> },
            // ADR-0011 admin console (Task 30): its own lazy chunk, role-gated inside.
            {
              path: "/admin",
              lazy: async () => ({
                Component: (await import("../admin/AdminLayout.js")).AdminLayout,
              }),
              children: [
                { index: true, element: <Navigate to="/admin/config" replace /> },
                {
                  path: "config",
                  lazy: async () => ({
                    Component: (await import("../admin/AdminLayout.js")).AdminConfigPage,
                  }),
                },
                {
                  path: "users",
                  lazy: async () => ({
                    Component: (await import("../admin/AdminLayout.js")).AdminUsersPage,
                  }),
                },
              ],
            },
          ],
        },
      ],
    },
    { path: "*", element: <Navigate to="/" replace /> },
  ];
}
