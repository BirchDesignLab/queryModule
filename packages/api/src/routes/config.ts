import type { Hono } from "hono";
import type { AppDeps } from "../deps";
import { requireSession } from "../http/session";
import type { AppEnv } from "../http/types";

export function mountConfigRoute(app: Hono<AppEnv>, d: AppDeps): void {
  app.get("/api/v1/config", requireSession(d.identity), (c) => c.json(d.config.clientConfig));
}
