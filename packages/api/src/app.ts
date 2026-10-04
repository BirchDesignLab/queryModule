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
import type { AppEnv } from "./http/types";
import { mountWeb } from "./http/web";
import { errorFields } from "./log/error-fields";
import { ReplayIntegrityError } from "./queries/admission";
import { SubmitTransactionError } from "./queries/errors";
import { mountQueriesRoute } from "./queries/route";
import { mountConfigRoute } from "./routes/config";
import { mountPreferencesRoute } from "./routes/preferences";
import { mountPublicRoutes } from "./routes/public";

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
  // D-A26: adminGuard answers 403 passwordChangeRequired after its feature check (#505 N-m1).
  mountAdminConfigRoutes(app, d);
  mountAdminUserRoutes(app, d);
  mountWeb(app, d);
  app.notFound((c) => apiError(c, "notFound"));
  // LS-1 (spec 5.9): a query error's message carries its params, so an unhandled error logs its
  // name and driver code only; the submit errors keep their fixed-text message.
  app.onError((err, c) => {
    d.logger.error("unhandled", {
      err: errorFields(err, [SubmitTransactionError, ReplayIntegrityError]),
      method: c.req.method,
      path: c.req.path,
    });
    return apiError(c, "internal");
  });
  return app;
}
