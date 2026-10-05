import { createHash } from "node:crypto";
import { ConfigVersionSchema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import {
  bootstrapDocument,
  ConfigLoadError,
  canonicalJson,
  configDirOf,
  loadConfigDocument,
} from "../../src/config/load";
import type { Db } from "../../src/db/client";
import { CONFIG_VERSION_TRIGGER_SQL, checkConfigVersionTriggers } from "../../src/db/migrate";
import { buildDeps } from "../../src/deps";
import type { DeployEnv } from "../../src/env";
import { uuidv7 } from "../../src/ids";
import { ALL_ON, API, adminConfigApp, withSiteConfig } from "../helpers/admin-config";
import { migratedDb, TEST_SECRETS, testEnv } from "../helpers/fixture";

/*
 * #511 CFG-3, D-M2P0-2 (prototype shortcut), ADR-0011 addendum: a published row carries
 * document_hash, the SHA-256 of its stored document as stored, set once at publish (or seed) and
 * frozen by the trigger. Boot verifies it before the current schema applies defaults, so a field
 * the schema later defaults no longer refuses startup; a tampered row still does (NFR-003,
 * SEC-010). Rows from before migration 0009 get the hash once at first boot. configLoaded names
 * the version it loaded, and publish checks the live snapshot by version id.
 */

const NOW = Date.UTC(2026, 9, 5);
const sha256 = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");
const opts = { allowMockSources: true, now: NOW };

type Doc = { siteConfig: Record<string, unknown>; locales: object; mock?: object };

/** The all-on site as a stored document, with auth.session.idleMinutes (schema default 30) left out. */
async function docWithoutDefault(): Promise<Doc> {
  const { document } = await bootstrapDocument(ALL_ON, opts);
  const doc = JSON.parse(JSON.stringify(document)) as Doc;
  const auth = doc.siteConfig.auth as { session: Record<string, unknown> };
  delete auth.session.idleMinutes;
  return doc;
}

/** The hash today's rule gives: the stored document resolved with the current schema's defaults. */
async function resolvedHash(doc: Doc): Promise<string> {
  const c = await loadConfigDocument(doc, { label: "t", configDir: configDirOf(ALL_ON), ...opts });
  return c.configHash;
}

/** A store holding one published version 1 written as a 0008-era row (no document_hash). */
async function storeWith(doc: Doc, configHash: string): Promise<DeployEnv> {
  const env = testEnv({ SITE_CONFIG: ALL_ON });
  const db = await migratedDb(env);
  await db.$client.execute({
    sql: "INSERT INTO site_config_version (id, site_id, version, status, document, config_hash, created_by, created_at, published_by, published_at) VALUES (?, ?, 1, 'published', ?, ?, 'system', ?, 'system', ?)",
    args: [uuidv7(NOW), "default", JSON.stringify(doc), configHash, NOW, NOW],
  });
  db.$client.close();
  return env;
}

async function hashes(db: Db) {
  const r = await db.$client.execute(
    "SELECT version, status, document, config_hash, document_hash FROM site_config_version ORDER BY version",
  );
  return r.rows.map((x) => ({
    version: Number(x.version),
    status: String(x.status),
    document: String(x.document),
    documentHash: x.document_hash === null ? null : String(x.document_hash),
  }));
}

async function boot(env: DeployEnv) {
  const deps = await buildDeps({ env, secrets: TEST_SECRETS, logSink: () => {} });
  const live = deps.config.current();
  const rows = await hashes(deps.db);
  deps.db.$client.close();
  return { live, rows };
}

const bootError = (env: DeployEnv) =>
  buildDeps({ env, secrets: TEST_SECRETS, logSink: () => {} }).then(
    () => null,
    (e: unknown) => e,
  );

describe("#511 CFG-3 D-M2P0-2 a field the schema defaults since publish", () => {
  it("boots with the default applied, and publish works twice right after boot", async () => {
    const doc = await docWithoutDefault();
    const env = await storeWith(doc, sha256(doc.siteConfig));
    const a = await adminConfigApp({ env: { DATA_DIR: env.dataDir } });
    const live = a.t.deps.config.current();
    expect(live.siteConfig.auth.session.idleMinutes).toBe(30);
    // The served hash is the current schema's resolve, not the stored one.
    expect(live.configHash).toBe(await resolvedHash(doc));
    expect(live.configHash).not.toBe(sha256(doc.siteConfig));
    expect(live.versionId).toBe(await idOf(a.t.deps.db, 1));

    for (const version of [2, 3]) {
      const served = a.t.deps.config.current().configHash;
      const v = await a.exportVersion(version - 1);
      const put = await a.call("implementer", "PUT", `${API}/draft`, {
        baseVersion: version - 1,
        document: v,
      });
      expect(put.status).toBe(200);
      const r = await a.call("implementer", "POST", `${API}/publish`, { draftVersion: version });
      expect(r.status).toBe(200);
      const published = ConfigVersionSchema.parse(await r.json());
      expect(a.t.deps.config.current().versionId).toBe(published.id);
      const event = (await a.t.auditRows("configPublished")).at(-1);
      expect(event?.details.previousConfigHash).toBe(served);
      const loaded = (await a.t.auditRows("configLoaded")).at(-1);
      expect(loaded?.details.versionId).toBe(published.id);
    }
  });
});

async function idOf(db: Db, version: number): Promise<string> {
  const r = await db.$client.execute({
    sql: "SELECT id FROM site_config_version WHERE version = ?",
    args: [version],
  });
  return String(r.rows[0]?.id);
}

describe("#511 CFG-3 document_hash is taken at publish", () => {
  it("a draft saved twice in place has no hash; published, it boots again", async () => {
    const a = await adminConfigApp();
    const v1 = await a.exportVersion(1);
    for (const agency of ["FIRSTSAVE", "SECONDSAVE"]) {
      const edited = withSiteConfig(v1, (sc) => {
        sc.defaults = { ...(sc.defaults as Record<string, string>), agency };
      });
      const put = await a.call("implementer", "PUT", `${API}/draft`, {
        baseVersion: 1,
        document: edited,
      });
      expect(put.status).toBe(200);
    }
    expect((await hashes(a.t.deps.db)).map((r) => [r.version, r.status, r.documentHash])).toEqual([
      [1, "published", expect.stringMatching(/^[0-9a-f]{64}$/)],
      [2, "draft", null],
    ]);
    const r = await a.call("implementer", "POST", `${API}/publish`, { draftVersion: 2 });
    expect(r.status).toBe(200);
    const rows = await hashes(a.t.deps.db);
    for (const row of rows) expect(row.documentHash).toBe(sha256(JSON.parse(row.document)));
    a.t.deps.db.$client.close();

    const again = await boot(a.t.env);
    expect(again.live.siteConfig.defaults.agency).toBe("SECONDSAVE");
    expect(again.live.versionId).toBe(ConfigVersionSchema.parse(await r.json()).id);
  });

  it("a stored document altered after publish refuses startup (config.hashMismatch)", async () => {
    const a = await adminConfigApp();
    const db = a.t.deps.db;
    const [row] = await hashes(db);
    const doc = JSON.parse(String(row?.document)) as Doc;
    (doc.siteConfig.defaults as Record<string, string>).agency = "TAMPERED";
    await db.$client.execute("DROP TRIGGER site_config_version_frozen");
    await db.$client.execute({
      sql: "UPDATE site_config_version SET document = ? WHERE version = 1",
      args: [JSON.stringify(doc)],
    });
    // Restored, so the boot passes the trigger check and reaches the hash check.
    await db.$client.execute(CONFIG_VERSION_TRIGGER_SQL.site_config_version_frozen);
    db.$client.close();
    const err = await bootError(a.t.env);
    expect(err).toBeInstanceOf(ConfigLoadError);
    expect(String((err as Error).message)).toMatch(/site default version 1.*config.hashMismatch/);
    expect(String((err as Error).message)).not.toContain("TAMPERED");
  });

  it("a published document_hash never changes nor returns to NULL (trigger, 0009)", async () => {
    const env = testEnv({ SITE_CONFIG: ALL_ON });
    const { live } = await boot(env);
    expect(live.versionId).toMatch(/.+/);
    const db = await migratedDb(env);
    await checkConfigVersionTriggers(db);
    for (const set of [`document_hash = '${"1".repeat(64)}'`, "document_hash = NULL"])
      await expect(db.$client.execute(`UPDATE site_config_version SET ${set}`)).rejects.toThrow(
        /never rewritten/,
      );
    await db.$client.execute("UPDATE site_config_version SET status = 'superseded'");
    await expect(
      db.$client.execute("UPDATE site_config_version SET document_hash = NULL"),
    ).rejects.toThrow(/never rewritten/);
  });
});

describe("#511 CFG-3 one-time backfill of 0008-era published rows", () => {
  it("accepts a row whose config_hash is the hash of its stored siteConfig", async () => {
    const doc = await docWithoutDefault();
    const env = await storeWith(doc, sha256(doc.siteConfig));
    const { rows } = await boot(env);
    expect(rows[0]?.documentHash).toBe(sha256(doc));
    // A second boot verifies the hash it wrote.
    expect((await boot(env)).rows[0]?.documentHash).toBe(sha256(doc));
  });

  it("accepts a row whose config_hash is today's rule (the defaults-applied resolve)", async () => {
    const doc = await docWithoutDefault();
    const env = await storeWith(doc, await resolvedHash(doc));
    const { rows } = await boot(env);
    expect(rows[0]?.documentHash).toBe(sha256(doc));
  });

  it("refuses a row whose config_hash matches neither rule, writing nothing", async () => {
    const doc = await docWithoutDefault();
    const env = await storeWith(doc, "0".repeat(64));
    const err = await bootError(env);
    expect(err).toBeInstanceOf(ConfigLoadError);
    expect(String((err as Error).message)).toMatch(/site default version 1.*config.hashMismatch/);
    const db = await migratedDb(env);
    expect((await hashes(db))[0]?.documentHash).toBeNull();
  });
});
