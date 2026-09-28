import { Hono } from "hono";
import { cors } from "hono/cors";
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
  app.use("/api/v1/*", bodyCap(), requireRequestedWith());
  mountAuthRoutes(app, d);
  app.notFound((c) => apiError(c, "notFound"));
  app.onError((err, c) => {
    d.logger.error("unhandled", { err, method: c.req.method, path: c.req.path });
    return apiError(c, "internal");
  });
  return app;
}
