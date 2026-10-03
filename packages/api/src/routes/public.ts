import { LOCALE_PATTERN } from "@querymodule/core/config";
import {
  API_VERSION,
  CONFIG_SCHEMA_VERSION,
  CORE_VERSION,
  MetaResponseSchema,
} from "@querymodule/core/contracts";
import type { Hono } from "hono";
import type { AppDeps } from "../deps";
import { apiError } from "../http/errors";
import type { AppEnv } from "../http/types";

export function mountPublicRoutes(app: Hono<AppEnv>, d: AppDeps): void {
  app.get("/api/v1/health", (c) => c.json({ status: "ok" }));
  app.get("/api/v1/meta", (c) =>
    c.json(
      MetaResponseSchema.parse({
        apiVersion: API_VERSION,
        coreVersion: CORE_VERSION,
        configSchemaVersion: CONFIG_SCHEMA_VERSION,
        configHash: d.config.current().configHash,
        minClientVersion: d.env.minClientVersion,
      }),
    ),
  );
  app.get("/api/v1/locales/:locale", (c) => {
    const locale = c.req.param("locale");
    if (!LOCALE_PATTERN.test(locale)) return apiError(c, "validationFailed");
    const { locales } = d.config.current();
    if (!Object.hasOwn(locales, locale)) return apiError(c, "notFound");
    return c.json(locales[locale]);
  });
}
