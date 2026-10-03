import { resolve } from "node:path";
import {
  type AuditEvent,
  CONFIG_SCHEMA_VERSION,
  CORE_VERSION,
  SYSTEM_ACTOR,
} from "@querymodule/core/contracts";
import { and, eq } from "drizzle-orm";
import { ConfigLoadError, configDirOf, loadConfigDocument } from "../../config/load";
import { siteConfigVersion } from "../../db/schema";
import { withTransaction } from "../../db/tx";
import type { AppDeps } from "../../deps";
import { parseStored } from "./store";

/**
 * ADR-0011 item 3 (checker ruling 1, AC1): activates stored draft `version` of the live site.
 * The stored document runs the full spec 5.8 chain first; then ONE transaction supersedes the
 * published row, publishes the draft with its hash, and writes configLoaded and the caller's
 * `event` (Task 27 passes configPublished). The in-process snapshot swaps only after commit, so
 * any failure (validation, audit, database) leaves the old snapshot live and the statuses
 * unchanged. Errors name the site and version only, never document content (spec 5.9).
 * `expected` (Task 27 publish and rollback): the transaction refuses with config.liveChanged
 * unless `expected.live` is still the published version, and with config.versionChanged unless
 * the draft still holds `expected.document`, the document the caller validated and built its
 * event from. So the event's previousConfigHash, configHash and changedPointers cannot go stale
 * between the caller's read and the commit (an in-place draft save in between, critic:C1).
 * Returns the row as published (the UPDATE's RETURNING), so a caller needs no read after the
 * commit that could fail a change that already happened (C-m1).
 */
export async function activate(
  d: AppDeps,
  version: number,
  event?: AuditEvent,
  expected?: { live: number; document: string },
): Promise<typeof siteConfigVersion.$inferSelect> {
  const siteId = d.config.current().siteConfig.site.id;
  const label = `store site ${siteId} version ${version}`;
  const [row] = await d.db
    .select()
    .from(siteConfigVersion)
    .where(and(eq(siteConfigVersion.siteId, siteId), eq(siteConfigVersion.version, version)));
  if (!row) throw new ConfigLoadError(label, "", "config.versionNotFound");
  if (row.status !== "draft") throw new ConfigLoadError(label, "", "config.versionNotDraft");
  if (expected !== undefined && row.document !== expected.document)
    throw new ConfigLoadError(label, "", "config.versionChanged");
  const config = await loadConfigDocument(parseStored(row.document, label), {
    label,
    configDir: configDirOf(resolve(d.env.siteConfigFile)),
    allowMockSources: d.env.allowMockSources,
    now: d.clock.now(),
  });
  if (config.siteConfig.site.id !== siteId)
    throw new ConfigLoadError(label, "/siteConfig/site/id", "config.siteMismatch");
  // Same refusal as the startup MFA guard (startup.ts, T19 spec:CV1); removed with it in #216.
  if (config.siteConfig.auth.mfaRequired !== false)
    throw new ConfigLoadError(label, "/siteConfig/auth/mfaRequired", "config.mfaNotEnforced");
  const activated = await withTransaction(d.db, async (tx) => {
    const superseded = await tx
      .update(siteConfigVersion)
      .set({ status: "superseded" })
      .where(and(eq(siteConfigVersion.siteId, siteId), eq(siteConfigVersion.status, "published")))
      .returning({ version: siteConfigVersion.version });
    if (expected !== undefined && superseded[0]?.version !== expected.live)
      throw new ConfigLoadError(label, "", "config.liveChanged");
    // Only the draft exactly as validated: an edit since the read publishes nothing.
    const published = await tx
      .update(siteConfigVersion)
      .set({
        status: "published",
        configHash: config.configHash,
        publishedBy: event?.actor.id ?? SYSTEM_ACTOR.id,
        publishedAt: d.clock.now(),
      })
      .where(
        and(
          eq(siteConfigVersion.id, row.id),
          eq(siteConfigVersion.status, "draft"),
          eq(siteConfigVersion.document, row.document),
        ),
      )
      .returning();
    const [done] = published;
    if (published.length !== 1 || !done)
      throw new ConfigLoadError(label, "", "config.versionChanged");
    await d.audit.record(tx, {
      type: "configLoaded",
      actor: SYSTEM_ACTOR,
      identitySource: "system",
      details: {
        siteId,
        configHash: config.configHash,
        configSchemaVersion: CONFIG_SCHEMA_VERSION,
        coreVersion: CORE_VERSION,
        extendsChain: config.extendsChain,
      },
    });
    if (event) await d.audit.record(tx, event);
    return done;
  });
  // Before the swap, so no reader of the new snapshot logs a new field key unredacted (C1).
  d.logger.addRedactKeys(config.fieldKeys);
  d.config.swap(config);
  return activated;
}
