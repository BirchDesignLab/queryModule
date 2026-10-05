import { resolve } from "node:path";
import { checkFixturePolicy, type Diagnostic } from "@querymodule/core/config";
import {
  type ConfigDocument,
  ConfigDocumentSchema,
  type ConfigVersion,
  ConfigVersionSchema,
  MockFileSchema,
  type ValidationError,
} from "@querymodule/core/contracts";
import { and, desc, eq, isNull, max } from "drizzle-orm";
import { type ChainResult, checkConfigDocument, configDirOf } from "../../config/load";
import type { Db } from "../../db/client";
import { siteConfigVersion } from "../../db/schema";
import { type Tx, withTransaction } from "../../db/tx";
import type { AppDeps } from "../../deps";
import { uuidv7 } from "../../ids";
import type { Principal } from "../../seams";
import { parseStored } from "./store";

export type VersionRow = typeof siteConfigVersion.$inferSelect;

export const siteIdOf = (d: AppDeps): string => d.config.current().siteConfig.site.id;

/** A row as the admin sees it (ConfigVersionSchema): metadata only, no document. */
export function toConfigVersion(row: VersionRow): ConfigVersion {
  return ConfigVersionSchema.parse({
    id: row.id,
    version: row.version,
    status: row.status,
    configHash: row.configHash,
    baseVersion: row.baseVersion,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
    rollbackOf: row.rollbackOf,
  });
}

/** The stored document; a parse failure names the site and version only (spec 5.9). */
export function documentOf(row: VersionRow): ConfigDocument {
  return ConfigDocumentSchema.parse(
    parseStored(row.document, `store site ${row.siteId} version ${row.version}`),
  );
}

/** The published version. Startup seeds or refuses, so a running app always has one. */
export async function liveRow(db: Db | Tx, siteId: string): Promise<VersionRow> {
  const [row] = await db
    .select()
    .from(siteConfigVersion)
    .where(and(eq(siteConfigVersion.siteId, siteId), eq(siteConfigVersion.status, "published")));
  if (!row) throw new Error(`store site ${siteId} has no published version`);
  return row;
}

export async function versionRow(
  db: Db | Tx,
  siteId: string,
  version: number,
): Promise<VersionRow | undefined> {
  const [row] = await db
    .select()
    .from(siteConfigVersion)
    .where(and(eq(siteConfigVersion.siteId, siteId), eq(siteConfigVersion.version, version)));
  return row;
}

/**
 * The site's one shared draft (ADR-0011 item 5). A rollback's own draft row (rollback_of set)
 * exists only while that rollback activates it, so it is never the shared draft.
 */
export async function sharedDraft(db: Db | Tx, siteId: string): Promise<VersionRow | undefined> {
  const [row] = await db
    .select()
    .from(siteConfigVersion)
    .where(
      and(
        eq(siteConfigVersion.siteId, siteId),
        eq(siteConfigVersion.status, "draft"),
        isNull(siteConfigVersion.rollbackOf),
      ),
    )
    .orderBy(desc(siteConfigVersion.version))
    .limit(1);
  return row;
}

/** Versions increase per site and are never reused while a row holds them. */
export async function nextVersion(tx: Tx, siteId: string): Promise<number> {
  const [row] = await tx
    .select({ top: max(siteConfigVersion.version) })
    .from(siteConfigVersion)
    .where(eq(siteConfigVersion.siteId, siteId));
  return (row?.top ?? 0) + 1;
}

/**
 * #511 T27 IC1 (spec 5.4, 10.8): the fixture policy on the document's mock, whenever it parses
 * as a mock file (schema faults are the chain's config.mockSchema). One error per finding, at
 * /mock plus the policy pointer; key and pointer only, never the value (spec 5.9).
 */
export function fixtureFindings(document: unknown): Diagnostic[] {
  const doc = ConfigDocumentSchema.safeParse(document);
  if (!doc.success || doc.data.mock === undefined) return [];
  const mock = MockFileSchema.safeParse(doc.data.mock);
  if (!mock.success) return [];
  return checkFixturePolicy(mock.data).map((f) => ({
    level: "error",
    path: `/mock${f.pointer}`,
    key: f.key,
    params: {},
  }));
}

export type SaveDraftResult =
  | { ok: true; row: VersionRow }
  | { ok: false; code: "draftConflict" }
  | { ok: false; code: "validationFailed"; errors: ValidationError[] };

/**
 * PUT /admin/config/draft (ADR-0011 item 5): one transaction checks the optimistic lock (the
 * base must be the live version) and writes the shared draft. A draft is not validated (it may
 * be work in progress) and not audited (item 7: the row records its author), with one exception:
 * a mock that breaks the fixture policy is refused before anything is stored, so non-fixture
 * data never reaches the database even as a draft (#511 T27 IC1; spec 5.4, 10.8). The draft keeps
 * its version while it is the newest row; once a publish or rollback has passed it, the save
 * removes it (a draft row is never history) and writes the draft as the next version, so
 * versions stay in history order.
 */
export async function saveDraft(
  d: AppDeps,
  principal: Principal,
  body: { baseVersion: number; document: ConfigDocument },
): Promise<SaveDraftResult> {
  const fixtures = fixtureFindings(body.document);
  if (fixtures.length > 0)
    return {
      ok: false,
      code: "validationFailed",
      errors: fixtures.map((f) => ({ key: f.key, params: { path: f.path } })),
    };
  const siteId = siteIdOf(d);
  return withTransaction(d.db, async (tx): Promise<SaveDraftResult> => {
    const live = await liveRow(tx, siteId);
    if (body.baseVersion !== live.version) return { ok: false, code: "draftConflict" };
    const document = JSON.stringify(body.document);
    const now = d.clock.now();
    const draft = await sharedDraft(tx, siteId);
    const next = await nextVersion(tx, siteId);
    if (draft && draft.version === next - 1) {
      const [row] = await tx
        .update(siteConfigVersion)
        .set({ document, baseVersion: live.version, createdBy: principal.userId, createdAt: now })
        .where(and(eq(siteConfigVersion.id, draft.id), eq(siteConfigVersion.status, "draft")))
        .returning();
      if (!row) throw new Error(`store site ${siteId} draft ${draft.version} changed`);
      return { ok: true, row };
    }
    if (draft)
      await tx
        .delete(siteConfigVersion)
        .where(and(eq(siteConfigVersion.id, draft.id), eq(siteConfigVersion.status, "draft")));
    const [row] = await tx
      .insert(siteConfigVersion)
      .values({
        id: uuidv7(now),
        siteId,
        version: next,
        status: "draft",
        document,
        configHash: null,
        baseVersion: live.version,
        createdBy: principal.userId,
        createdAt: now,
        publishedBy: null,
        publishedAt: null,
        rollbackOf: null,
      })
      .returning();
    if (!row) throw new Error(`store site ${siteId} draft not written`);
    return { ok: true, row };
  });
}

/**
 * POST /admin/config/validate and the publish and rollback refusal (ADR-0011 items 2, 3 and 5):
 * the spec 5.8 chain on the document (the same validateSiteConfig the browser runs, with the
 * server-only adapter kind and mock coverage checks), then the checks activate() applies (the
 * document names the live site; auth.mfaRequired stays false until MFA is enforced, #216), and
 * one only this chain applies: features.adminConfig stays true, so a publish cannot lock the
 * config API (#505 T27 Q6). The fixture policy findings on the mock (#511 T27 IC1) join the
 * errors whatever the chain answers, so publish and rollback refuse them too.
 */
export async function validateDocument(d: AppDeps, document: unknown): Promise<ChainResult> {
  const siteId = siteIdOf(d);
  const fixtures = fixtureFindings(document);
  const r = await checkConfigDocument(document, {
    label: `store site ${siteId} candidate`,
    configDir: configDirOf(resolve(d.env.siteConfigFile)),
    allowMockSources: d.env.allowMockSources,
    now: d.clock.now(),
  });
  if (!r.ok) return fixtures.length > 0 ? { ...r, errors: [...r.errors, ...fixtures] } : r;
  const errors: Diagnostic[] = [];
  if (r.config.siteConfig.site.id !== siteId)
    errors.push({ level: "error", path: "/site/id", key: "config.siteMismatch", params: {} });
  // The activate() refusal (startup MFA guard, T19 spec:CV1), shown before publish.
  if (r.config.siteConfig.auth.mfaRequired !== false)
    errors.push({
      level: "error",
      path: "/auth/mfaRequired",
      key: "config.mfaNotEnforced",
      params: {},
    });
  // #505 T27 Q6 (ADR-0011 item 6): with adminConfig off the config API answers 404, so a publish
  // or rollback could not be undone in the app. Refused like any error, and shown before publish.
  if (r.config.siteConfig.features.adminConfig !== true)
    errors.push({
      level: "error",
      path: "/features/adminConfig",
      key: "config.adminConfigOff",
      params: {},
    });
  errors.push(...fixtures);
  return errors.length > 0 ? { ok: false, errors, warnings: r.config.warnings } : r;
}
