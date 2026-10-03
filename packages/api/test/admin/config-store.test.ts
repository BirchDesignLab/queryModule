import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigDocumentSchema, SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { loadLiveConfig } from "../../src/admin/config/store";
import { ConfigLoadError, loadSiteConfig } from "../../src/config/load";
import type { Db } from "../../src/db/client";
import { checkConfigVersionTriggers, TriggerMissingError } from "../../src/db/migrate";
import { buildDeps } from "../../src/deps";
import type { DeployEnv } from "../../src/env";
import { uuidv7 } from "../../src/ids";
import { migratedDb, TEST_SECRETS, testEnv } from "../helpers/fixture";
import { removeTempDirs } from "../helpers/temp-dirs";

/*
 * ADR-0011 item 1 and 2, spec 5.8 (overridden by ADR-0011): the SITE_CONFIG file is the bootstrap;
 * an empty store seeds version 1 from it and the store is the live source afterwards. Every boot
 * runs the full spec 5.8 chain on the stored document (fail closed). BR-001, BR-004, SEC-010.
 */

const bundled = resolve(import.meta.dirname, "../../../config");
const created: string[] = [];
afterAll(() => removeTempDirs(created.splice(0), "test/admin/config-store"));

/** A writable copy of the bundled config tree; returns the copied default site file. */
function siteCopy(): string {
  const d = mkdtempSync(join(tmpdir(), "qm-store-"));
  created.push(d);
  for (const sub of ["sites", "locales", "mock"])
    cpSync(join(bundled, sub), join(d, sub), { recursive: true });
  return join(d, "sites/default.json");
}

const NOW = Date.UTC(2026, 9, 2);
const boot = (file: string, allowMockSources = true) => ({
  siteConfigFile: file,
  allowMockSources,
  now: NOW,
});

interface Row {
  id: string;
  site_id: string;
  version: number;
  status: string;
  document: string;
  config_hash: string | null;
  base_version: number | null;
  created_by: string;
  created_at: number;
  published_by: string | null;
  published_at: number | null;
  rollback_of: number | null;
}
async function rows(db: Db): Promise<Row[]> {
  const r = await db.$client.execute("SELECT * FROM site_config_version ORDER BY site_id, version");
  return r.rows.map((x) => ({ ...x }) as unknown as Row);
}

/** Inserts a row as a raw statement, so a test can place any document in the store. */
async function insertRow(
  db: Db,
  o: { version: number; status: string; document: string; siteId?: string; hash?: string | null },
): Promise<string> {
  const id = uuidv7(NOW);
  await db.$client.execute({
    sql: "INSERT INTO site_config_version (id, site_id, version, status, document, config_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'system', ?)",
    args: [id, o.siteId ?? "default", o.version, o.status, o.document, o.hash ?? null, NOW],
  });
  return id;
}

async function depsLog(env: DeployEnv) {
  const lines: Record<string, unknown>[] = [];
  const deps = await buildDeps({
    env,
    secrets: TEST_SECRETS,
    logSink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
  });
  deps.db.$client.close();
  return { deps, lines };
}

describe("BR-001 ADR-0011 an empty store seeds version 1 from the site file", () => {
  it("boots from the file and holds version 1, published by the system actor", async () => {
    const file = siteCopy();
    const env = testEnv({ SITE_CONFIG: file });
    const db = await migratedDb(env);
    const live = await loadLiveConfig(db, boot(file));
    const fromFile = await loadSiteConfig(file, { allowMockSources: true, now: NOW });
    expect(live.version).toBe(1);
    expect(live.seeded).toBe(true);
    expect(live.fileIgnored).toBe(false);
    expect(live.configHash).toBe(fromFile.configHash);
    expect(live.siteConfig).toEqual(fromFile.siteConfig);
    expect(live.locales).toEqual(fromFile.locales);
    const [row, ...rest] = await rows(db);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      id: live.versionId,
      site_id: "default",
      version: 1,
      status: "published",
      config_hash: fromFile.configHash,
      base_version: null,
      created_by: SYSTEM_ACTOR.id,
      created_at: NOW,
      published_by: SYSTEM_ACTOR.id,
      published_at: NOW,
      rollback_of: null,
    });
    // The resolved file, an empty locale overlay and (mock sources allowed) the mock file.
    const doc = ConfigDocumentSchema.parse(JSON.parse(String(row?.document)));
    expect(doc.locales).toEqual({});
    expect(doc.siteConfig).toEqual(JSON.parse(JSON.stringify(fromFile.siteConfig)));
    expect(doc.mock).toEqual(
      JSON.parse(readFileSync(join(file, "../../mock/default.json"), "utf8")),
    );
  });

  it("C-m4: a boot sweeps a rollback draft left by an interrupted rollback; a shared draft stays", async () => {
    const file = siteCopy();
    const env = testEnv({ SITE_CONFIG: file });
    const db = await migratedDb(env);
    await loadLiveConfig(db, boot(file));
    const [live] = await rows(db);
    await insertRow(db, { version: 2, status: "draft", document: String(live?.document) });
    const orphan = await insertRow(db, {
      version: 3,
      status: "draft",
      document: String(live?.document),
    });
    await db.$client.execute({
      sql: "UPDATE site_config_version SET rollback_of = 1 WHERE id = ?",
      args: [orphan],
    });
    const again = await loadLiveConfig(db, boot(file));
    expect(again.version).toBe(1);
    expect((await rows(db)).map((r) => [Number(r.version), r.status, r.rollback_of])).toEqual([
      [1, "published", null],
      [2, "draft", null],
    ]);
  });

  it("stores the resolved config of a site that extends another, without extends", async () => {
    const file = join(siteCopy(), "../example-ok.json");
    const env = testEnv({ SITE_CONFIG: file });
    const db = await migratedDb(env);
    const live = await loadLiveConfig(db, boot(file));
    const fromFile = await loadSiteConfig(file, { allowMockSources: true, now: NOW });
    expect(live.configHash).toBe(fromFile.configHash);
    const doc = JSON.parse(String((await rows(db))[0]?.document)) as { siteConfig: object };
    expect(doc.siteConfig).not.toHaveProperty("extends");
    expect((await rows(db))[0]?.site_id).toBe("example-ok");
  });

  it("refuses an invalid site file and seeds nothing", async () => {
    const file = siteCopy();
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, site: { id: "default" } }));
    const db = await migratedDb(testEnv({ SITE_CONFIG: file }));
    await expect(loadLiveConfig(db, boot(file))).rejects.toThrow(ConfigLoadError);
    expect(await rows(db)).toEqual([]);
  });
});

describe("BR-001 ADR-0011 the store is the live source after the first boot", () => {
  it("a second boot loads version 1 from the store even if the file changed, warning once", async () => {
    const file = siteCopy();
    const env = testEnv({ SITE_CONFIG: file });
    const first = await depsLog(env);
    expect(first.lines.filter((l) => l.msg === "site config file ignored")).toEqual([]);
    expect(first.lines.filter((l) => l.msg === "config store seeded")).toEqual([
      expect.objectContaining({ level: "info", site: "default", version: 1 }),
    ]);

    // Unchanged file: no warning, same version.
    const same = await depsLog(env);
    expect(same.lines.filter((l) => l.msg === "site config file ignored")).toEqual([]);
    expect(same.lines.filter((l) => l.msg === "config store seeded")).toEqual([]);

    const site = JSON.parse(readFileSync(file, "utf8")) as { defaults: Record<string, string> };
    site.defaults.state = "ZZ";
    writeFileSync(file, JSON.stringify(site));
    const second = await depsLog(env);
    expect(second.deps.config.current().configHash).toBe(first.deps.config.current().configHash);
    expect(second.deps.config.current().siteConfig.defaults).toEqual(
      first.deps.config.current().siteConfig.defaults,
    );
    const warned = second.lines.filter((l) => l.msg === "site config file ignored");
    expect(warned).toEqual([
      expect.objectContaining({
        level: "warn",
        file: env.siteConfigFile,
        site: "default",
        version: 1,
      }),
    ]);
    expect(JSON.stringify(second.lines)).not.toContain('"ZZ"');
  });

  it("an unreadable file after the first boot is ignored with the same warning", async () => {
    const file = siteCopy();
    const env = testEnv({ SITE_CONFIG: file });
    await depsLog(env);
    const site = JSON.parse(readFileSync(file, "utf8")) as { queryTypes: unknown };
    site.queryTypes = "not a list";
    writeFileSync(file, JSON.stringify(site));
    const again = await depsLog(env);
    expect(again.deps.config.current().siteConfig.site.id).toBe("default");
    expect(again.lines.filter((l) => l.msg === "site config file ignored")).toHaveLength(1);
  });

  it("loads the label overlay over the bundled locale files", async () => {
    const file = siteCopy();
    const seededDb = await migratedDb(testEnv({ SITE_CONFIG: file }));
    const seeded = await loadLiveConfig(seededDb, boot(file));
    const doc = ConfigDocumentSchema.parse(JSON.parse(String((await rows(seededDb))[0]?.document)));
    const [key] = Object.keys(seeded.locales.en ?? {});
    // A second store whose version 1 overlays one label.
    const db = await migratedDb(testEnv({ SITE_CONFIG: file }));
    await insertRow(db, {
      version: 1,
      status: "published",
      document: JSON.stringify({ ...doc, locales: { en: { [String(key)]: "Overlay text" } } }),
      hash: seeded.configHash,
    });
    const live = await loadLiveConfig(db, boot(file));
    expect(live.locales.en?.[String(key)]).toBe("Overlay text");
  });
});

describe("ADR-0011 item 2: the locale overlay and a broken bundled locale file", () => {
  /** A store seeded from a copy, then the copy's bundled en.json replaced by `bundle`. */
  async function withBundle(bundle: string | null, overlay: Record<string, string>) {
    const file = siteCopy();
    const db = await migratedDb(testEnv({ SITE_CONFIG: file }));
    const seeded = await loadLiveConfig(db, boot(file));
    const doc = ConfigDocumentSchema.parse(JSON.parse(String((await rows(db))[0]?.document)));
    const fresh = await migratedDb(testEnv({ SITE_CONFIG: file }));
    await insertRow(fresh, {
      version: 1,
      status: "published",
      document: JSON.stringify({ ...doc, locales: { en: overlay } }),
      hash: seeded.configHash,
    });
    const en = join(file, "../../locales/en.json");
    if (bundle === null) rmSync(en);
    else writeFileSync(en, bundle);
    return { file, db: fresh, seeded };
  }
  it("an overlay supplies a locale whose bundled file is missing", async () => {
    const file = siteCopy();
    const labels = JSON.parse(readFileSync(join(file, "../../locales/en.json"), "utf8"));
    const { file: f, db, seeded } = await withBundle(null, labels as Record<string, string>);
    const live = await loadLiveConfig(db, boot(f));
    expect(live.locales.en).toEqual(seeded.locales.en);
  });
  it("a bundled locale file that is not an object refuses, overlay or not", async () => {
    const { file, db } = await withBundle("[]", { "site.name": "x" });
    await expect(loadLiveConfig(db, boot(file))).rejects.toThrow(
      /site default version 1 at \/locales\/0: config.invalidJson/,
    );
  });
  it("a missing site file with an empty store refuses and seeds nothing", async () => {
    const file = siteCopy();
    rmSync(file);
    const db = await migratedDb(testEnv({ SITE_CONFIG: file }));
    await expect(loadLiveConfig(db, boot(file))).rejects.toThrow(/config.fileMissing/);
    expect(await rows(db)).toEqual([]);
  });
});

describe("spec 5.8 fail closed: an invalid stored document refuses startup naming the version", () => {
  async function storeWith(document: string) {
    const file = siteCopy();
    const env = testEnv({ SITE_CONFIG: file });
    const db = await migratedDb(env);
    await insertRow(db, { version: 1, status: "superseded", document: "{}", hash: "0".repeat(64) });
    await insertRow(db, { version: 2, status: "published", document, hash: "0".repeat(64) });
    db.$client.close();
    return env;
  }
  const valid = async () => {
    const file = siteCopy();
    const db = await migratedDb(testEnv({ SITE_CONFIG: file }));
    await loadLiveConfig(db, boot(file));
    return JSON.parse(String((await rows(db))[0]?.document)) as {
      siteConfig: Record<string, unknown>;
      locales: Record<string, unknown>;
      mock?: unknown;
    };
  };

  for (const [label, reason, document] of [
    ["is not JSON", "/: config.invalidJson", async () => "SECRETVALUE{"],
    [
      "is not a ConfigDocument",
      "/locales: config.documentSchema",
      async () => JSON.stringify({ siteConfig: {}, extra: "SECRETVALUE" }),
    ],
    [
      "fails the strict parse",
      "/queryTypes: config.schema",
      async () => {
        const d = await valid();
        return JSON.stringify({ ...d, siteConfig: { ...d.siteConfig, queryTypes: "SECRETVALUE" } });
      },
    ],
    [
      "has a schemaVersion newer than this build",
      "/schemaVersion: config.schemaVersionTooNew",
      async () => {
        const d = await valid();
        return JSON.stringify({ ...d, siteConfig: { ...d.siteConfig, schemaVersion: 999 } });
      },
    ],
    [
      "fails validateSiteConfig",
      "/site/labelKey: config.missingLabel",
      async () => {
        const d = await valid();
        const site = d.siteConfig.site as Record<string, unknown>;
        return JSON.stringify({
          ...d,
          siteConfig: { ...d.siteConfig, site: { ...site, labelKey: "site.zzNoSuchLabel" } },
        });
      },
    ],
    [
      "lacks mock coverage",
      "/site/id: config.missingMockFile",
      async () => {
        const { mock: _mock, ...d } = await valid();
        return JSON.stringify(d);
      },
    ],
    [
      "names another site",
      "/siteConfig/site/id: config.siteMismatch",
      async () => {
        const d = await valid();
        const site = d.siteConfig.site as Record<string, unknown>;
        return JSON.stringify({
          ...d,
          siteConfig: { ...d.siteConfig, site: { ...site, id: "other" } },
          mock: { ...(d.mock as object), siteId: "other" },
        });
      },
    ],
  ] as const) {
    it(`refuses a stored document that ${label}`, async () => {
      const env = await storeWith(await document());
      const err = await buildDeps({ env, secrets: TEST_SECRETS, logSink: () => {} }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ConfigLoadError);
      expect(String((err as Error).message)).toMatch(/site default version 2/);
      expect(String((err as Error).message)).toContain(reason);
      expect(String((err as Error).message)).not.toContain("SECRETVALUE");
    });
  }

  it("refuses a published version whose stored config_hash differs from its document (C4)", async () => {
    const env = await storeWith(JSON.stringify(await valid()));
    const err = await buildDeps({ env, secrets: TEST_SECRETS, logSink: () => {} }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConfigLoadError);
    expect(String((err as Error).message)).toMatch(/site default version 2/);
    expect(String((err as Error).message)).toContain("config.hashMismatch");
  });

  it("refuses a store with rows for the site but no published version, seeding nothing", async () => {
    const file = siteCopy();
    const env = testEnv({ SITE_CONFIG: file });
    const db = await migratedDb(env);
    await insertRow(db, { version: 1, status: "draft", document: "{}" });
    await expect(loadLiveConfig(db, boot(file))).rejects.toThrow(
      /site default.*config.noPublishedVersion/,
    );
    expect((await rows(db)).map((r) => r.status)).toEqual(["draft"]);
  });

  it("refuses mock sources in the stored document without ALLOW_MOCK_SOURCES", async () => {
    const file = siteCopy();
    const db = await migratedDb(testEnv({ SITE_CONFIG: file }));
    await loadLiveConfig(db, boot(file));
    await expect(loadLiveConfig(db, boot(file, false))).rejects.toThrow(/site default version 1/);
  });
});

describe("SEC-010 ADR-0011 item 1: published history is never rewritten (migration 0007)", () => {
  async function seeded() {
    const file = siteCopy();
    const db = await migratedDb(testEnv({ SITE_CONFIG: file }));
    await loadLiveConfig(db, boot(file));
    return db;
  }
  const exec = (db: Db, sql: string) => db.$client.execute(sql);

  it("UPDATE of a published document aborts", async () => {
    const db = await seeded();
    await expect(exec(db, "UPDATE site_config_version SET document = '{}'")).rejects.toThrow(
      /never rewritten/,
    );
  });
  it("UPDATE of a published or superseded config_hash aborts", async () => {
    const db = await seeded();
    await expect(
      exec(db, `UPDATE site_config_version SET config_hash = '${"1".repeat(64)}'`),
    ).rejects.toThrow(/never rewritten/);
    await exec(db, "UPDATE site_config_version SET status = 'superseded'");
    await expect(exec(db, "UPDATE site_config_version SET document = '{}'")).rejects.toThrow(
      /never rewritten/,
    );
  });
  it("a superseded row never returns to published, even with none live (#497 C-m1, 0008)", async () => {
    const db = await seeded();
    await exec(db, "UPDATE site_config_version SET status = 'superseded'");
    for (const status of ["published", "draft"])
      await expect(exec(db, `UPDATE site_config_version SET status = '${status}'`)).rejects.toThrow(
        /never rewritten/,
      );
    expect((await rows(db)).map((r) => [r.version, r.status])).toEqual([[1, "superseded"]]);
  });
  it("a published row cannot return to draft, change identity, or be deleted", async () => {
    const db = await seeded();
    for (const set of [
      "status = 'draft'",
      "version = 7",
      "site_id = 'x'",
      "id = 'x'",
      "rowid = 99",
    ])
      await expect(exec(db, `UPDATE site_config_version SET ${set}`)).rejects.toThrow(
        /never rewritten/,
      );
    await expect(exec(db, "DELETE FROM site_config_version")).rejects.toThrow(/never deleted/);
    expect((await rows(db)).map((r) => [r.version, r.status])).toEqual([[1, "published"]]);
  });
  it("a published or superseded row's authorship and lineage never change (C1)", async () => {
    const db = await seeded();
    const sets = [
      "created_by = 'x'",
      "created_at = 1",
      "published_by = 'x'",
      "published_at = 1",
      "base_version = 9",
      "rollback_of = 9",
    ];
    for (const set of sets)
      await expect(exec(db, `UPDATE site_config_version SET ${set}`)).rejects.toThrow(
        /never rewritten/,
      );
    await exec(db, "UPDATE site_config_version SET status = 'superseded'");
    for (const set of sets)
      await expect(exec(db, `UPDATE site_config_version SET ${set}`)).rejects.toThrow(
        /never rewritten/,
      );
  });
  it("INSERT OR REPLACE cannot replace a published row, nor add a second published row", async () => {
    const db = await seeded();
    const [row] = await rows(db);
    await expect(
      exec(
        db,
        `INSERT OR REPLACE INTO site_config_version (id, site_id, version, status, document, created_by, created_at) VALUES ('${row?.id}', 'default', 9, 'draft', '{}', 'u', 1)`,
      ),
    ).rejects.toThrow(/never replaced/);
    await expect(
      exec(
        db,
        "INSERT OR REPLACE INTO site_config_version (id, site_id, version, status, document, created_by, created_at) VALUES ('n', 'default', 1, 'draft', '{}', 'u', 1)",
      ),
    ).rejects.toThrow(/never replaced/);
    await expect(
      exec(
        db,
        "INSERT OR REPLACE INTO site_config_version (id, site_id, version, status, document, config_hash, created_by, created_at) VALUES ('n', 'default', 2, 'published', '{}', 'h', 'u', 1)",
      ),
    ).rejects.toThrow(/never replaced/);
    await expect(
      exec(
        db,
        `INSERT OR REPLACE INTO site_config_version (rowid, id, site_id, version, status, document, created_by, created_at) VALUES (${await rowidOf(db)}, 'n', 'default', 2, 'draft', '{}', 'u', 1)`,
      ),
    ).rejects.toThrow(/never replaced/);
    expect(await rows(db)).toEqual([row]);
  });
  it("a draft cannot be published over a live version, nor take a non-positive rowid", async () => {
    const db = await seeded();
    await exec(
      db,
      "INSERT INTO site_config_version (id, site_id, version, status, document, created_by, created_at) VALUES ('d', 'default', 2, 'draft', '{}', 'u', 1)",
    );
    await expect(
      exec(db, "UPDATE OR REPLACE site_config_version SET status = 'published' WHERE id = 'd'"),
    ).rejects.toThrow(/never rewritten/);
    await expect(
      exec(
        db,
        "INSERT INTO site_config_version (rowid, id, site_id, version, status, document, created_by, created_at) VALUES (-1, 'e', 'default', 3, 'draft', '{}', 'u', 1)",
      ),
    ).rejects.toThrow(/rowids are positive/);
  });
  it("a draft may be edited and deleted", async () => {
    const db = await seeded();
    await exec(
      db,
      "INSERT INTO site_config_version (id, site_id, version, status, document, created_by, created_at) VALUES ('d', 'default', 2, 'draft', '{}', 'u', 1)",
    );
    await exec(db, `UPDATE site_config_version SET document = '{"a":1}' WHERE id = 'd'`);
    await exec(db, "DELETE FROM site_config_version WHERE id = 'd'");
    expect((await rows(db)).map((r) => r.version)).toEqual([1]);
  });
  it("status is draft, published or superseded, and (site, version) is unique", async () => {
    const db = await seeded();
    await expect(
      exec(
        db,
        "INSERT INTO site_config_version (id, site_id, version, status, document, created_by, created_at) VALUES ('d', 'default', 2, 'bogus', '{}', 'u', 1)",
      ),
    ).rejects.toThrow(/CHECK constraint/);
    await expect(
      exec(
        db,
        "INSERT INTO site_config_version (id, site_id, version, status, document, created_by, created_at) VALUES ('d', 'default', 1, 'draft', '{}', 'u', 1)",
      ),
    ).rejects.toThrow(/never replaced/);
    // The unique index holds on its own, not only through the no_replace trigger.
    await exec(db, "DROP TRIGGER site_config_version_no_replace");
    await expect(
      exec(
        db,
        "INSERT INTO site_config_version (id, site_id, version, status, document, created_by, created_at) VALUES ('d', 'default', 1, 'draft', '{}', 'u', 1)",
      ),
    ).rejects.toThrow(
      /UNIQUE constraint failed: site_config_version\.site_id, site_config_version\.version/,
    );
  });
  it("startup refuses when a site_config_version trigger is missing or altered", async () => {
    const db = await seeded();
    await checkConfigVersionTriggers(db);
    await exec(db, "DROP TRIGGER site_config_version_frozen");
    const err = await checkConfigVersionTriggers(db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TriggerMissingError);
    expect((err as TriggerMissingError).missing).toEqual(["site_config_version_frozen"]);
  });
  it("buildDeps refuses when a site_config_version trigger is missing", async () => {
    const env = testEnv();
    const db = await migratedDb(env);
    await exec(db, "DROP TRIGGER site_config_version_no_delete");
    db.$client.close();
    const err = await buildDeps({ env, secrets: TEST_SECRETS }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TriggerMissingError);
  });
});

async function rowidOf(db: Db): Promise<number> {
  const r = await db.$client.execute("SELECT rowid AS r FROM site_config_version LIMIT 1");
  return Number(r.rows[0]?.r);
}
