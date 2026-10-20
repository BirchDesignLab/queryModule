import type { ClientSiteConfigResponse } from "@querymodule/core/config";
import type { Hono } from "hono";
import type { AppDeps } from "../deps";
import { requireSession } from "../http/session";
import type { AppEnv } from "../http/types";

export function mountConfigRoute(app: Hono<AppEnv>, d: AppDeps): void {
  app.get("/api/v1/config", requireSession(d.identity), (c) => {
    // One snapshot: the view and its versionId always come from the same published version
    // (#46 CFG-1). A label-only publish changes versionId while configHash stays (CFG-3).
    const snap = d.config.current();
    const body: ClientSiteConfigResponse = { ...snap.clientConfig, versionId: snap.versionId };
    return c.json(body);
  });
}
