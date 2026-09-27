import "@querymodule/tokens/tokens.css";
import "./shell.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Shell } from "./shell";
import { applyThemeMode } from "./theme";

applyThemeMode("day");

const router = createBrowserRouter([{ path: "/", element: <Shell /> }]);
const container = document.getElementById("root");
if (!container) throw new Error("#root missing from index.html");

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
