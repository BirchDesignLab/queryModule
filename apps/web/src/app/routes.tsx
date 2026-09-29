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
          ],
        },
      ],
    },
    { path: "*", element: <Navigate to="/" replace /> },
  ];
}
