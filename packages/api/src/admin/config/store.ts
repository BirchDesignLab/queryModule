import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BOUNDED_ID_PATTERN, SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  bootstrapDocument,
  ConfigLoadError,
  canonicalJson,
  configDirOf,
  loadConfigDocument,
  loadSiteConfig,
  type VersionedConfig,
} from "../../config/load";
import type { Db } from "../../db/client";
import { siteConfigVersion } from "../../db/schema";
import { withTransaction } from "../../db/tx";
import { uuidv7 } from "../../ids";

/** The SITE_CONFIG file and the load options: the bootstrap of an empty store (ADR-0011 item 1). */
export interface ConfigBootstrap {
  siteConfigFile: string;
  allowMockSources: boolean;
  now: number;
}

/** The live version's config, validated by the full spec 5.8 chain, and where it came from. */
export interface LiveConfig extends VersionedConfig {
  version: number;
  /** This boot seeded version 1 from the file (the store was empty for the site). */
  seeded: boolean;
  /** The file differs from the live document (or no longer loads) and was not used. */
  fileIgnored: boolean;
}

/**
 * The site id the SITE_CONFIG file names, read without the chain so an edited or broken file
 * cannot keep a populated store from booting. Null when the file does not name a valid id
 * directly (missing, not JSON, or the id comes from a base site); the caller then loads it.
 */
async function siteIdOfFile(file: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as { site?: { id?: unknown } } | null;
    const id = raw?.site?.id;
    return typeof id === "string" && BOUNDED_ID_PATTERN.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function versionRows(db: Db, siteId: string) {
  const [published] = await db
    .select()
    .from(siteConfigVersion)
    .where(and(eq(siteConfigVersion.siteId, siteId), eq(siteConfigVersion.status, "published")));
  if (published) return { published, any: true };
  const [any] = await db
    .select({ id: siteConfigVersion.id })
    .from(siteConfigVersion)
    .where(eq(siteConfigVersion.siteId, siteId))
    .limit(1);
  return { published: undefined, any: any !== undefined };
}

/** The stored JSON text as a value; a parse error is fixed text, never the stored content. */
export function parseStored(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ConfigLoadError(label, "", "config.invalidJson");
  }
}

const sha256 = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");

/** #511 CFG-3: a row's document_hash, the SHA-256 of its parsed stored document as stored. */
export const documentHashOf = (document: unknown): string => sha256(document);

/**
 * #511 CFG-3: the one-time document_hash of a published row from before migration 0009. The row
 * is accepted only if its config_hash is the hash of its stored siteConfig (seed and publish store
 * the resolved siteConfig) or today's rule (`resolvedHash`, the defaults-applied resolve); else it
 * was altered outside the app and startup refuses (fail closed).
 */
async function backfillDocumentHash(
  db: Db,
  row: typeof siteConfigVersion.$inferSelect,
  document: unknown,
  resolvedHash: string,
  label: string,
): Promise<void> {
  const { siteConfig } = document as { siteConfig: unknown };
  if (row.configHash !== sha256(siteConfig) && row.configHash !== resolvedHash)
    throw new ConfigLoadError(label, "", "config.hashMismatch");
  await withTransaction(db, async (tx) => {
    await tx
      .update(siteConfigVersion)
      .set({ documentHash: documentHashOf(document) })
      .where(and(eq(siteConfigVersion.id, row.id), isNull(siteConfigVersion.documentHash)));
  });
}

/**
 * ADR-0011 items 1 and 2, spec 5.8 (overridden by ADR-0011): the live site config at startup. An
 * empty store for the file's site seeds version 1 from the file (resolved, validated); afterwards
 * the store is the live source and the file is only compared, never used. Every boot runs the
 * full chain on the stored document; an invalid one throws ConfigLoadError naming the site and
 * version, never document content (fail closed). A store with versions for the site but none
 * published also refuses, and seeds nothing.
 */
export async function loadLiveConfig(db: Db, bootstrap: ConfigBootstrap): Promise<LiveConfig> {
  const file = resolve(bootstrap.siteConfigFile);
  const siteId =
    (await siteIdOfFile(file)) ?? (await loadSiteConfig(file, bootstrap)).siteConfig.site.id;
  let { published, any } = await versionRows(db, siteId);
  let seeded = false;
  if (!published) {
    if (any) throw new ConfigLoadError(`store site ${siteId}`, "", "config.noPublishedVersion");
    const boot = await bootstrapDocument(file, bootstrap);
    const now = bootstrap.now;
    const text = JSON.stringify(boot.document);
    const row: typeof siteConfigVersion.$inferSelect = {
      id: uuidv7(now),
      siteId,
      version: 1,
      status: "published",
      document: text,
      configHash: boot.config.configHash,
      documentHash: documentHashOf(JSON.parse(text)),
      baseVersion: null,
      createdBy: SYSTEM_ACTOR.id,
      createdAt: now,
      publishedBy: SYSTEM_ACTOR.id,
      publishedAt: now,
      rollbackOf: null,
    };
    await withTransaction(db, async (tx) => {
      await tx.insert(siteConfigVersion).values(row);
    });
    published = row;
    seeded = true;
  }
  // C-m4: a rollback's own row is a draft only between its insert and activate()'s commit, both
  // in one request; one left at boot is from an interrupted rollback, never history. Remove it.
  await withTransaction(db, async (tx) => {
    await tx
      .delete(siteConfigVersion)
      .where(
        and(
          eq(siteConfigVersion.siteId, siteId),
          eq(siteConfigVersion.status, "draft"),
          isNotNull(siteConfigVersion.rollbackOf),
        ),
      );
  });
  const label = `store site ${siteId} version ${published.version}`;
  const document = parseStored(published.document, label);
  // Prototype shortcut (D-M2P0-2): verify the stored document as stored, then apply defaults. The
  // proper fix is a config schema version with an audited migration of stored rows; see #558.
  // A mismatch means the row was altered outside the app (the triggers refuse it from inside), so
  // refuse to boot (fail closed).
  if (published.documentHash !== null && published.documentHash !== documentHashOf(document))
    throw new ConfigLoadError(label, "", "config.hashMismatch");
  const config = await loadConfigDocument(document, {
    label,
    configDir: configDirOf(file),
    allowMockSources: bootstrap.allowMockSources,
    now: bootstrap.now,
  });
  if (config.siteConfig.site.id !== siteId)
    throw new ConfigLoadError(label, "/siteConfig/site/id", "config.siteMismatch");
  if (published.documentHash === null)
    await backfillDocumentHash(db, published, document, config.configHash, label);
  const fileIgnored =
    !seeded &&
    (await bootstrapDocument(file, bootstrap).then(
      (b) => canonicalJson(b.document) !== canonicalJson(document),
      () => true,
    ));
  return { ...config, versionId: published.id, version: published.version, seeded, fileIgnored };
}
