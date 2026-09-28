import "@querymodule/tokens/tokens.css";
import "./shell.css";
import "@querymodule/web-ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./app/Root.js";
import { createServices } from "./app/services.js";
import { APP_VERSION } from "./app/version.js";
import { createWebPlatform } from "./platform/web-platform.js";

const container = document.getElementById("root");
if (container === null) throw new Error("#root missing");
const services = createServices({ baseUrl: window.location.origin, platform: createWebPlatform() });
createRoot(container).render(
  <StrictMode>
    <Root services={services} clientVersion={APP_VERSION} />
  </StrictMode>,
);
