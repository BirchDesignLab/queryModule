import {
  AdminConfigResponseSchema,
  ConfigDocumentSchema,
  ConfigVersionListSchema,
  PublishConfigBodySchema,
  PutDraftBodySchema,
  ValidateConfigBodySchema,
  ValidateConfigResponseSchema,
  VersionParamsSchema,
} from "@querymodule/core/contracts";
import { desc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import { siteConfigVersion } from "../../db/schema";
import type { AppDeps } from "../../deps";
import { apiError } from "../../http/errors";
import type { AppEnv } from "../../http/types";
import { adminGuard, CONFIG_EDITOR_ROLES } from "../access";
import {
  documentOf,
  liveRow,
  saveDraft,
  sharedDraft,
  siteIdOf,
  toConfigVersion,
  validateDocument,
  versionRow,
} from "./draft";
import { type PublishResult, publishDraft, rollbackTo } from "./publish";

const BASE = "/api/v1/admin/config";

/**
 * A whole config document can pass the 32 KiB API body cap (ADR-0011 item 2), so draft save
 * and validate take this cap instead; createApp skips the API cap for exactly these paths.
 */
export const ADMIN_CONFIG_BODY_CAP = 256 * 1024;
export const ADMIN_CONFIG_LARGE_BODY_PATHS: ReadonlySet<string> = new Set([
  `${BASE}/draft`,
  `${BASE}/validate`,
]);

const largeBody = bodyLimit({
  maxSize: ADMIN_CONFIG_BODY_CAP,
  onError: (c) => apiError(c as never, "payloadTooLarge"),
});

async function bodyOf<T extends z.ZodType>(c: Context<AppEnv>, schema: T) {
  return schema.safeParse(await c.req.json().catch(() => undefined));
}

function versionParam(c: Context<AppEnv>): number | undefined {
  const p = VersionParamsSchema.safeParse({ version: c.req.param("version") });
  return p.success ? p.data.version : undefined;
}

function answer(c: Context<AppEnv>, r: PublishResult): Response {
  if (r.ok) return c.json(r.version);
  if (r.code === "validationFailed") return apiError(c, r.code, undefined, r.errors);
  return apiError(c, r.code);
}

/**
 * The admin config routes (ADR-0011 items 3 to 6; contracts in core admin.ts and routes.ts):
 * configEditor access behind the adminConfig feature. Nothing from a document is logged; error
 * bodies carry message keys and pointers only (spec 5.9).
 */
export function mountAdminConfigRoutes(app: Hono<AppEnv>, d: AppDeps): void {
  const guard = adminGuard(d, "adminConfig", CONFIG_EDITOR_ROLES);

  app.get(BASE, guard, async (c) => {
    const siteId = siteIdOf(d);
    const live = await liveRow(d.db, siteId);
    const draft = await sharedDraft(d.db, siteId);
    return c.json(
      AdminConfigResponseSchema.parse({
        siteId,
        live: { ...toConfigVersion(live), document: documentOf(live) },
        draft: draft ? { ...toConfigVersion(draft), document: documentOf(draft) } : null,
      }),
    );
  });

  app.put(`${BASE}/draft`, guard, largeBody, async (c) => {
    const body = await bodyOf(c, PutDraftBodySchema);
    if (!body.success) return apiError(c, "validationFailed");
    const r = await saveDraft(d, c.get("principal"), body.data);
    if (!r.ok)
      return r.code === "validationFailed"
        ? apiError(c, r.code, undefined, r.errors)
        : apiError(c, r.code);
    return c.json(toConfigVersion(r.row));
  });

  app.post(`${BASE}/validate`, guard, largeBody, async (c) => {
    const body = await bodyOf(c, ValidateConfigBodySchema);
    if (!body.success) return apiError(c, "validationFailed");
    const r = await validateDocument(d, body.data.document);
    return c.json(
      ValidateConfigResponseSchema.parse(
        r.ok
          ? { errors: [], warnings: r.config.warnings }
          : { errors: r.errors, warnings: r.warnings },
      ),
    );
  });

  app.post(`${BASE}/publish`, guard, async (c) => {
    const body = await bodyOf(c, PublishConfigBodySchema);
    if (!body.success) return apiError(c, "validationFailed");
    return answer(c, await publishDraft(d, c.get("principal"), body.data.draftVersion));
  });

  app.get(`${BASE}/versions`, guard, async (c) => {
    const rows = await d.db
      .select()
      .from(siteConfigVersion)
      .where(eq(siteConfigVersion.siteId, siteIdOf(d)))
      .orderBy(desc(siteConfigVersion.version))
      .limit(1000);
    return c.json(ConfigVersionListSchema.parse({ versions: rows.map(toConfigVersion) }));
  });

  app.post(`${BASE}/versions/:version/rollback`, guard, async (c) => {
    const version = versionParam(c);
    if (version === undefined) return apiError(c, "validationFailed");
    return answer(c, await rollbackTo(d, c.get("principal"), version));
  });

  app.get(`${BASE}/versions/:version/export`, guard, async (c) => {
    const version = versionParam(c);
    if (version === undefined) return apiError(c, "validationFailed");
    const row = await versionRow(d.db, siteIdOf(d), version);
    if (!row) return apiError(c, "notFound");
    return c.json(ConfigDocumentSchema.parse(documentOf(row)));
  });
}
