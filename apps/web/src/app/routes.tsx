import { Navigate, type RouteObject } from "react-router";
import { HomePage } from "../home/HomePage.js";
import { LoginPage } from "../login/LoginPage.js";
import { StatusPage } from "../status/StatusPage.js";
import { RequireAuth } from "./RequireAuth.js";

export function appRoutes(clientSupported: boolean): RouteObject[] {
  return [
    { path: "/login", element: <LoginPage clientSupported={clientSupported} /> },
    {
      element: <RequireAuth />,
      children: [
        { path: "/", element: <HomePage /> },
        { path: "/status", element: <StatusPage /> },
      ],
    },
    { path: "*", element: <Navigate to="/" replace /> },
  ];
}
