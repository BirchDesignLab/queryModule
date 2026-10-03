import type { FeatureKey } from "@querymodule/core/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ADMIN_CONFIG_LARGE_BODY_PATHS, mountAdminConfigRoutes } from "./admin/config/routes";
import { mountAdminUserRoutes } from "./admin/users/routes";
import { mountAuthRoutes } from "./auth/routes";
import type { AppDeps } from "./deps";
import { apiError } from "./http/errors";
import {
  bodyCap,
  noStore,
  requestId,
  requireRequestedWith,
  securityHeaders,
} from "./http/security";
import { requirePasswordChanged } from "./http/session";
import type { AppEnv } from "./http/types";
import { mountWeb } from "./http/web";
import { mountQueriesRoute } from "./queries/route";
import { mountConfigRoute } from "./routes/config";
import { mountPreferencesRoute } from "./routes/preferences";
import { mountPublicRoutes } from "./routes/public";

/** The feature each admin route prefix sits behind (admin/config/routes.ts, admin/users/routes.ts). */
const ADMIN_FEATURES: readonly (readonly [string, FeatureKey])[] = [
  ["/api/v1/admin/config", "adminConfig"],
  ["/api/v1/admin/users", "adminUsers"],
  ["/api/v1/admin/sessions", "adminUsers"],
];

export function createApp(d: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requestId(), securityHeaders());
  app.use("*", async (c, next) => {
    const t = performance.now();
    await next();
    d.logger.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - t),
    });
  });
  app.use(
    "/api/*",
    noStore(),
    cors({
      origin: d.env.corsOrigins,
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE"],
      allowHeaders: [
        "Content-Type",
        "X-Requested-With",
        "Idempotency-Key",
        "Authorization",
        "X-Background",
      ],
    }),
  );
  // The admin config draft and validate routes apply their own larger cap (ADR-0011 item 2).
  const apiCap = bodyCap();
  app.use(
    "/api/v1/*",
    (c, next) => (ADMIN_CONFIG_LARGE_BODY_PATHS.has(c.req.path) ? next() : apiCap(c, next)),
    requireRequestedWith(),
  );
  mountAuthRoutes(app, d);
  mountPublicRoutes(app, d);
  mountConfigRoute(app, d);
  mountQueriesRoute(app, d);
  mountPreferencesRoute(app, d);
  // D-A26: no admin route for a user who still holds a temporary password. Only where the
  // route's feature is on (G-m1): a feature-off route answers 404 to every caller (adminGuard).
  const adminFeatureOn = (path: string) => {
    const hit = ADMIN_FEATURES.find(([p]) => path === p || path.startsWith(`${p}/`));
    return hit === undefined || d.config.current().siteConfig.features[hit[1]] === true;
  };
  app.use("/api/v1/admin/*", requirePasswordChanged(d.identity, adminFeatureOn));
  mountAdminConfigRoutes(app, d);
  mountAdminUserRoutes(app, d);
  mountWeb(app, d);
  app.notFound((c) => apiError(c, "notFound"));
  app.onError((err, c) => {
    d.logger.error("unhandled", { err, method: c.req.method, path: c.req.path });
    return apiError(c, "internal");
  });
  return app;
}
