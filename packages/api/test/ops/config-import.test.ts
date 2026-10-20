import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigDocumentSchema } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { loadLiveConfig } from "../../src/admin/config/store";
import { user } from "../../src/db/schema";
import { buildDeps } from "../../src/deps";
import {
  CONFIG_IMPORT_COMMAND,
  ConfigImportRefusedError,
  ConfigImportUsageError,
  IMPORT_LABELS_LINE,
  IMPORT_NOTE,
  importReport,
  importSiteConfig,
  parseConfigImportArgs,
  RESTART_COMMAND,
  refusalLines,
} from "../../src/ops/config-import";
import { type AdminConfigApp, ALL_ON, API, adminConfigApp } from "../helpers/admin-config";
import { TEST_SECRETS, testEnv } from "../helpers/fixture";
import { removeTempDirs } from "../helpers/temp-dirs";

/*
 * #792 CFG-4, D-M2P3-4, ADR-0011 item 1: config:import validates the image's site config as boot
 * does, compares it with the published version, prints diffConfig lines, and publishes it through
 * the builder's publish path (saveDraft, publishDraft, activate) with the normal configPublished
 * row as a named admin (BR-001, BR-004, SEC-010). The published label overlay is kept.
 */

/*
 * #825 C-M1 race seams: each hook runs once, at the gap it names, then clears. Every other call
 * passes through unchanged (the builder's routes import the same functions).
 */
const hooks = vi.hoisted(() => ({
  afterDraftCheck: null as null | (() => Promise<void>),
  beforePublish: null as null | (() => Promise<void>),
}));
vi.mock("../../src/admin/config/draft", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/admin/config/draft")>();
  return {
    ...m,
    sharedDraft: async (...a: Parameters<typeof m.sharedDraft>) => {
      const r = await m.sharedDraft(...a);
      const h = hooks.afterDraftCheck;
      hooks.afterDraftCheck = null;
      if (h) await h();
      return r;
    },
  };
});
vi.mock("../../src/admin/config/publish", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/admin/config/publish")>();
  return {
    ...m,
    publishDraft: async (...a: Parameters<typeof m.publishDraft>) => {
      const h = hooks.beforePublish;
      hooks.beforePublish = null;
      if (h) await h();
      return m.publishDraft(...a);
    },
  };
});

const bundled = resolve(import.meta.dirname, "../../../config");
const created: string[] = [];
afterAll(() => removeTempDirs(created.splice(0), "test/ops/config-import"));

/** A writable copy of the bundled config tree with all-on.json as edited by `edit`. */
function imageFile(edit: (site: Record<string, unknown>) => void = () => {}): string {
  const d = mkdtempSync(join(tmpdir(), "qm-import-"));
  created.push(d);
  for (const sub of ["sites", "locales", "mock", "test"])
    cpSync(join(bundled, sub), join(d, sub), { recursive: true });
  const file = join(d, "test/all-on.json");
  const site = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  edit(site);
  writeFileSync(file, JSON.stringify(site));
  return file;
}

const auditOff = (site: Record<string, unknown>) => {
  site.features = { ...(site.features as Record<string, boolean>), adminAudit: false };
};

/** Every row a write could touch: the store and the audit log. */
async function snapshot(a: AdminConfigApp) {
  const audit = await a.t.deps.db.$client.execute("SELECT id FROM audit_event ORDER BY id");
  return { versions: await a.versionRows(), audit: audit.rows.length };
}

async function adminApp() {
  const a = await adminConfigApp();
  const adminId = await a.userId("admin");
  return { a, adminId };
}

const run = (
  a: AdminConfigApp,
  file: string,
  o: Partial<{ adminEmail: string; dryRun: boolean; replaceDraft: boolean }> = {},
) =>
  importSiteConfig(a.t.deps, {
    file,
    adminEmail: o.adminEmail ?? "admin@example.test",
    dryRun: o.dryRun ?? false,
    replaceDraft: o.replaceDraft ?? false,
  });

async function refusal(p: Promise<unknown>): Promise<ConfigImportRefusedError> {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ConfigImportRefusedError);
  return e as ConfigImportRefusedError;
}

describe("CFG-4 config:import arguments", () => {
  it("parses --admin, --dry-run, --replace-draft and --file", () => {
    expect(parseConfigImportArgs(["--admin", "admin@example.test"])).toEqual({
      adminEmail: "admin@example.test",
      dryRun: false,
      replaceDraft: false,
    });
    expect(parseConfigImportArgs(["--dry-run"])).toEqual({ dryRun: true, replaceDraft: false });
    expect(
      parseConfigImportArgs([
        "--file",
        "/app/x.json",
        "--replace-draft",
        "--admin",
        "a@example.test",
      ]),
    ).toEqual({
      file: "/app/x.json",
      adminEmail: "a@example.test",
      dryRun: false,
      replaceDraft: true,
    });
  });

  it("is a usage error without --admin (unless --dry-run), on an unknown, repeated or bare flag", () => {
    for (const argv of [
      [],
      ["--replace-draft"],
      ["--admin"],
      ["--admin", "--dry-run"],
      ["--file"],
      ["--dry-run", "--dry-run"],
      ["--admin", "a@example.test", "--admin", "b@example.test"],
      ["--dry-run", "--force"],
      ["--dry-run", "extra"],
      ["--admin=a@example.test"],
    ])
      expect(() => parseConfigImportArgs(argv), argv.join(" ")).toThrow(ConfigImportUsageError);
  });
});

describe("BR-001 CFG-4 config:import compares the image with the published version", () => {
  it("the same file is unchanged and writes nothing", async () => {
    const { a } = await adminApp();
    const before = await snapshot(a);
    const r = await run(a, ALL_ON);
    expect(r).toEqual({ kind: "unchanged", versionId: a.t.deps.config.current().versionId });
    expect(await snapshot(a)).toEqual(before);
    const lines = importReport(r, {});
    expect(lines).toContain(IMPORT_LABELS_LINE);
    expect(lines.at(-1)).toBe("Nothing to do.");
  });

  it("--dry-run prints the change lines, the labels line and the import command, writing nothing", async () => {
    const { a } = await adminApp();
    const before = await snapshot(a);
    const r = await run(a, imageFile(auditOff), { dryRun: true, adminEmail: "" });
    expect(r.kind).toBe("dryRun");
    if (r.kind !== "dryRun") return;
    expect(r.changes).toEqual(["~ /siteConfig/features/adminAudit true -> false"]);
    expect(await snapshot(a)).toEqual(before);
    const lines = importReport(r, {});
    expect(lines).toContain("~ /siteConfig/features/adminAudit true -> false");
    expect(lines).toContain(IMPORT_LABELS_LINE);
    expect(lines.at(-1)).toBe(`${CONFIG_IMPORT_COMMAND} --admin admin@example.test`);
    expect(importReport(r, { adminEmail: "admin2@example.test", file: "/app/x.json" }).at(-1)).toBe(
      `${CONFIG_IMPORT_COMMAND} --file /app/x.json --admin admin2@example.test`,
    );
  });

  it("an invalid file refuses with its validation keys, before any write", async () => {
    const { a } = await adminApp();
    const before = await snapshot(a);
    const file = imageFile((s) => {
      s.queryTypes = "not a list";
    });
    for (const dryRun of [true, false]) {
      const e = await refusal(run(a, file, { dryRun }));
      expect(e.keys.length).toBeGreaterThan(0);
      expect(e.keys.every((k) => /^config\./.test(k.key))).toBe(true);
      expect(refusalLines(e).join("\n")).not.toContain("not a list");
    }
    expect(await snapshot(a)).toEqual(before);
  });

  it("a document validateDocument refuses (adminConfig off) refuses with its key", async () => {
    const { a } = await adminApp();
    const before = await snapshot(a);
    const file = imageFile((s) => {
      s.features = { ...(s.features as Record<string, boolean>), adminConfig: false };
    });
    const e = await refusal(run(a, file));
    expect(e.keys).toContainEqual({ key: "config.adminConfigOff", path: "/features/adminConfig" });
    expect(await snapshot(a)).toEqual(before);
  });

  it("a mock-gate failure (mock source, ALLOW_MOCK_SOURCES off) refuses before any write", async () => {
    const { a } = await adminApp();
    const before = await snapshot(a);
    const d = { ...a.t.deps, env: { ...a.t.deps.env, allowMockSources: false } };
    const e = await refusal(
      importSiteConfig(d, {
        file: imageFile(auditOff),
        adminEmail: "admin@example.test",
        dryRun: false,
        replaceDraft: false,
      }),
    );
    expect(e.keys).toHaveLength(1);
    expect(e.keys[0]?.path).toMatch(/^\/sources\/\d+\/kind$/);
    expect(await snapshot(a)).toEqual(before);
  });
});

describe("BR-001 SEC-010 CFG-4 config:import publishes as the named admin", () => {
  it("publishes version 2 with one configPublished row by that admin, no note in details", async () => {
    const { a, adminId } = await adminApp();
    const previous = a.t.deps.config.current().configHash;
    const loadedBefore = (await a.t.auditRows("configLoaded")).length;
    const r = await run(a, imageFile(auditOff));
    expect(r).toMatchObject({
      kind: "published",
      version: 2,
      changes: ["~ /siteConfig/features/adminAudit true -> false"],
    });
    if (r.kind !== "published") return;
    expect(r).not.toHaveProperty("replacedDraft");
    const live = a.t.deps.config.current();
    expect(live.versionId).toBe(r.versionId);
    expect(live.siteConfig.features.adminAudit).toBe(false);
    const rows = await a.t.auditRows("configPublished");
    expect(rows).toEqual([
      {
        id: rows[0]?.id,
        actorUserId: adminId,
        details: {
          siteId: "default",
          versionId: r.versionId,
          version: 2,
          configHash: live.configHash,
          previousConfigHash: previous,
          changedPointers: ["/siteConfig/features/adminAudit"],
        },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(IMPORT_NOTE);
    expect(await a.t.auditRows("configLoaded")).toHaveLength(loadedBefore + 1);
    const versions = await a.versionRows();
    expect(versions.map((v) => [v.version, v.status, v.publishedBy, v.createdBy])).toEqual([
      [1, "superseded", "system", "system"],
      [2, "published", adminId, adminId],
    ]);
    const note = await a.t.deps.db.$client.execute(
      "SELECT note FROM site_config_version WHERE version = 2",
    );
    expect(note.rows[0]?.note).toBe(IMPORT_NOTE);
    // A second run is unchanged.
    expect((await run(a, imageFile(auditOff))).kind).toBe("unchanged");
  });

  it("the output names the change, the labels line and ends with the restart command", async () => {
    const { a } = await adminApp();
    const r = await run(a, imageFile(auditOff));
    const lines = importReport(r, { adminEmail: "admin@example.test" });
    expect(lines).toContain("~ /siteConfig/features/adminAudit true -> false");
    expect(lines).toContain(IMPORT_LABELS_LINE);
    expect(lines.at(-1)).toBe(RESTART_COMMAND);
    expect(RESTART_COMMAND).toBe("docker compose restart app");
  });

  it("keeps the published label overlay and compares over it", async () => {
    const { a } = await adminApp();
    const live = a.t.deps.config.current();
    const [key] = Object.keys(live.locales.en ?? {});
    const v1 = await a.exportVersion(1);
    const overlay = { en: { [String(key)]: "Overlay text" } };
    expect(
      (
        await a.call("implementer", "PUT", `${API}/draft`, {
          baseVersion: 1,
          document: { ...v1, locales: overlay },
        })
      ).status,
    ).toBe(200);
    expect(
      (await a.call("implementer", "POST", `${API}/publish`, { draftVersion: 2 })).status,
    ).toBe(200);
    // The image matches the published siteConfig and mock: the overlay alone is no change.
    expect((await run(a, ALL_ON)).kind).toBe("unchanged");
    const r = await run(a, imageFile(auditOff));
    expect(r).toMatchObject({ kind: "published", version: 3 });
    const doc = ConfigDocumentSchema.parse(
      JSON.parse(String((await a.versionRows())[2]?.document)),
    );
    expect(doc.locales).toEqual(overlay);
    expect(a.t.deps.config.current().locales.en?.[String(key)]).toBe("Overlay text");
  });

  it("an unknown, full-width at sign, disabled or non-admin email refuses before any write", async () => {
    const { a } = await adminApp();
    await a.userId("implementer");
    await a.userId("user");
    const disabled = await a.t.createUser("admin2@example.test", "correct-horse-battery-1");
    await a.t.deps.db
      .update(user)
      .set({ role: "admin", disabledAt: 1 })
      .where(eq(user.id, disabled));
    const before = await snapshot(a);
    const file = imageFile(auditOff);
    const cases: [string, string][] = [
      ["nobody@example.test", "configImport.adminUnknown"],
      ["admin＠example.test", "configImport.adminUnknown"],
      ["admin2@example.test", "configImport.adminDisabled"],
      ["implementer@example.test", "configImport.adminNotAdmin"],
      ["user@example.test", "configImport.adminNotAdmin"],
      ["", "configImport.adminUnknown"],
    ];
    for (const [adminEmail, key] of cases) {
      const e = await refusal(run(a, file, { adminEmail }));
      expect(e.keys, adminEmail).toEqual([{ key, path: "" }]);
      expect(e.message).not.toMatch(/password/i);
    }
    expect(await snapshot(a)).toEqual(before);
    // The address is matched case-insensitively, as grant-role does.
    expect((await run(a, file, { adminEmail: " Admin@Example.TEST " })).kind).toBe("published");
  });

  it("an existing draft refuses without --replace-draft and is replaced with it", async () => {
    const { a, adminId } = await adminApp();
    const implementer = await a.userId("implementer");
    const v1 = await a.exportVersion(1);
    expect(
      (await a.call("implementer", "PUT", `${API}/draft`, { baseVersion: 1, document: v1 })).status,
    ).toBe(200);
    const before = await snapshot(a);
    const file = imageFile(auditOff);
    const e = await refusal(run(a, file));
    expect(e.keys).toEqual([{ key: "configImport.draftExists", path: "" }]);
    expect(e.message).toContain("version 2");
    expect(e.message).toContain(implementer);
    expect(e.message).toContain("--replace-draft");
    expect(await snapshot(a)).toEqual(before);

    const dry = await run(a, file, { dryRun: true });
    expect(dry).toMatchObject({ kind: "dryRun", draft: { version: 2, createdBy: implementer } });
    expect(importReport(dry, {}).join("\n")).toContain("--replace-draft");

    const r = await run(a, file, { replaceDraft: true });
    expect(r).toMatchObject({
      kind: "published",
      version: 2,
      replacedDraft: { version: 2, createdBy: implementer },
    });
    const text = importReport(r, {}).join("\n");
    expect(text).toContain("version 2");
    expect(text).toContain(implementer);
    expect((await a.t.auditRows("configPublished"))[0]?.actorUserId).toBe(adminId);
    expect((await a.versionRows()).map((v) => v.status)).toEqual(["superseded", "published"]);
  });

  it("a publish refused after the draft save leaves no draft of its own behind", async () => {
    const { a } = await adminApp();
    const current = a.t.deps.config.current();
    // The live snapshot no longer matches the live row: publishDraft answers draftConflict.
    a.t.deps.config.swap({ ...current, versionId: "00000000-0000-7000-8000-000000000000" });
    const before = await snapshot(a);
    const e = await refusal(run(a, imageFile(auditOff)));
    expect(e.keys).toEqual([{ key: "configImport.draftConflict", path: "" }]);
    expect(await snapshot(a)).toEqual(before);
  });

  it("refusal lines carry the message and each key, and nothing of an unknown error", () => {
    const e = new ConfigImportRefusedError("config:import refused", [
      { key: "config.schema", path: "/queryTypes" },
      { key: "configImport.draftExists", path: "" },
    ]);
    expect(refusalLines(e)).toEqual([
      "config:import refused",
      "  config.schema /queryTypes",
      "  configImport.draftExists /",
    ]);
    const secret = new TypeError("document text ZZSECRET");
    expect(refusalLines(secret)).toEqual(["config:import failed: TypeError"]);
    // #825: a busy database names its driver code, never the message (docs/deploy.md)
    const busy = Object.assign(new Error("SQLITE_BUSY: database is locked ZZSECRET"), {
      name: "LibsqlError",
      code: "SQLITE_BUSY",
    });
    expect(refusalLines(busy)).toEqual(["config:import failed: LibsqlError SQLITE_BUSY"]);
  });
});

describe("#825 config:import draft races, cleanup and attribution", () => {
  /** The stored draft row's adminAudit flag and author: the builder's draft keeps true. */
  const draftRow = async (a: AdminConfigApp) => {
    const row = (await a.versionRows()).find((v) => v.status === "draft");
    if (!row) return undefined;
    const doc = JSON.parse(row.document) as { siteConfig: { features: { adminAudit: boolean } } };
    return {
      version: row.version,
      createdBy: row.createdBy,
      adminAudit: doc.siteConfig.features.adminAudit,
    };
  };

  it("a builder draft saved after the draft check is not overwritten: the import refuses and publishes nothing (C-M1)", async () => {
    const { a } = await adminApp();
    const implementer = await a.userId("implementer");
    const v1 = await a.exportVersion(1);
    hooks.afterDraftCheck = async () => {
      const r = await a.call("implementer", "PUT", `${API}/draft`, {
        baseVersion: 1,
        document: v1,
      });
      expect(r.status).toBe(200);
    };
    const e = await refusal(run(a, imageFile(auditOff)));
    expect(hooks.afterDraftCheck).toBeNull();
    expect(e.keys).toEqual([{ key: "configImport.draftConflict", path: "" }]);
    expect(await draftRow(a)).toEqual({ version: 2, createdBy: implementer, adminAudit: true });
    expect(await a.t.auditRows("configPublished")).toEqual([]);
  });

  it("with --replace-draft, a builder save in place after the draft check is not overwritten (C-M1)", async () => {
    const { a } = await adminApp();
    const implementer = await a.userId("implementer");
    const v1 = await a.exportVersion(1);
    const put = (document: unknown) =>
      a.call("implementer", "PUT", `${API}/draft`, { baseVersion: 1, document });
    expect((await put(v1)).status).toBe(200);
    const [key] = Object.keys(a.t.deps.config.current().locales.en ?? {});
    const newer = { ...v1, locales: { en: { [String(key)]: "Newer builder text" } } };
    hooks.afterDraftCheck = async () => {
      expect((await put(newer)).status).toBe(200);
    };
    const e = await refusal(run(a, imageFile(auditOff), { replaceDraft: true }));
    expect(e.keys).toEqual([{ key: "configImport.draftConflict", path: "" }]);
    expect(await draftRow(a)).toEqual({ version: 2, createdBy: implementer, adminAudit: true });
    const stored = (await a.versionRows()).find((v) => v.status === "draft")?.document ?? "";
    expect(stored).toContain("Newer builder text");
    expect(await a.t.auditRows("configPublished")).toEqual([]);
  });

  it("a builder save in place between the import's draft save and its publish is not published as the admin (C-M1)", async () => {
    const { a } = await adminApp();
    const implementer = await a.userId("implementer");
    const v1 = await a.exportVersion(1);
    hooks.beforePublish = async () => {
      const r = await a.call("implementer", "PUT", `${API}/draft`, {
        baseVersion: 1,
        document: v1,
      });
      expect(r.status).toBe(200);
    };
    const e = await refusal(run(a, imageFile(auditOff)));
    expect(hooks.beforePublish).toBeNull();
    expect(e.keys).toEqual([{ key: "configImport.draftConflict", path: "" }]);
    // the builder's draft is not this run's document, so the cleanup leaves it
    expect(await draftRow(a)).toEqual({ version: 2, createdBy: implementer, adminAudit: true });
    expect(await a.t.auditRows("configPublished")).toEqual([]);
    expect(a.t.deps.config.current().siteConfig.features.adminAudit).toBe(true);
  });

  it("a publish that throws removes this run's draft and surfaces the original error class (C-M3)", async () => {
    const { a } = await adminApp();
    const before = await snapshot(a);
    const real = a.t.deps.audit;
    a.t.deps.audit = {
      record: async (tx, ev) => {
        if (ev.type === "configPublished") throw new TypeError("audit down ZZSECRET");
        return real.record(tx, ev);
      },
    };
    const e = await run(a, imageFile(auditOff)).then(
      () => undefined,
      (x: unknown) => x,
    );
    a.t.deps.audit = real;
    expect(e).toBeInstanceOf(TypeError);
    expect(refusalLines(e)).toEqual(["config:import failed: TypeError"]);
    expect(await snapshot(a)).toEqual(before);
  });

  it("a cleanup that throws after a throwing publish does not mask the original error (C-M2)", async () => {
    const { a } = await adminApp();
    const real = a.t.deps.audit;
    const db = a.t.deps.db;
    a.t.deps.audit = {
      record: async (tx, ev) => {
        if (ev.type === "configPublished") {
          // the next transaction (the cleanup) fails too
          vi.spyOn(db, "transaction").mockImplementationOnce(() =>
            Promise.reject(new RangeError("cleanup down")),
          );
          throw new TypeError("audit down");
        }
        return real.record(tx, ev);
      },
    };
    const e = await run(a, imageFile(auditOff)).then(
      () => undefined,
      (x: unknown) => x,
    );
    a.t.deps.audit = real;
    vi.mocked(db.transaction).mockRestore();
    expect(e).toBeInstanceOf(TypeError);
    expect(refusalLines(e)).toEqual(["config:import failed: TypeError"]);
  });

  it("a refused publish after --replace-draft says the replaced draft is not restored and leaves no draft (C-M3)", async () => {
    const { a } = await adminApp();
    const v1 = await a.exportVersion(1);
    expect(
      (await a.call("implementer", "PUT", `${API}/draft`, { baseVersion: 1, document: v1 })).status,
    ).toBe(200);
    const current = a.t.deps.config.current();
    a.t.deps.config.swap({ ...current, versionId: "00000000-0000-7000-8000-000000000000" });
    const e = await refusal(run(a, imageFile(auditOff), { replaceDraft: true }));
    expect(e.keys).toEqual([{ key: "configImport.draftConflict", path: "" }]);
    expect(e.message).toContain("is not restored");
    expect(await draftRow(a)).toBeUndefined();
    expect(await a.t.auditRows("configPublished")).toEqual([]);
  });

  it("the configPublished row takes identitySource and hostSubject from the admin's user row (C-M4, SEC-010)", async () => {
    const { a, adminId } = await adminApp();
    // a local admin (every demo admin) gives exactly the values the import wrote before C-M4
    expect((await run(a, imageFile(auditOff))).kind).toBe("published");
    await a.t.deps.db
      .update(user)
      .set({
        identitySource: "host",
        hostIssuer: "https://idp.example.test",
        hostSubject: "host-sub-1",
      })
      .where(eq(user.id, adminId));
    expect((await run(a, ALL_ON)).kind).toBe("published");
    const rows = await a.t.deps.db.$client.execute(
      "SELECT actor_user_id, identity_source, host_subject FROM audit_event WHERE type = 'configPublished' ORDER BY id",
    );
    expect(rows.rows.map((r) => [r.actor_user_id, r.identity_source, r.host_subject])).toEqual([
      [adminId, "local", null],
      [adminId, "host", "host-sub-1"],
    ]);
  });

  it("a published label overlay alone does not count as the file ignored at boot (C-M5)", async () => {
    const { a } = await adminApp();
    const [key] = Object.keys(a.t.deps.config.current().locales.en ?? {});
    const v1 = await a.exportVersion(1);
    const put = await a.call("implementer", "PUT", `${API}/draft`, {
      baseVersion: 1,
      document: { ...v1, locales: { en: { [String(key)]: "Overlay text" } } },
    });
    expect(put.status).toBe(200);
    expect(
      (await a.call("implementer", "POST", `${API}/publish`, { draftVersion: 2 })).status,
    ).toBe(200);
    const boot = (file: string) =>
      loadLiveConfig(a.t.deps.db, {
        siteConfigFile: file,
        allowMockSources: a.t.deps.env.allowMockSources,
        now: a.t.deps.clock.now(),
      });
    expect((await boot(ALL_ON)).fileIgnored).toBe(false);
    expect((await boot(imageFile(auditOff))).fileIgnored).toBe(true);
  });
});

describe("ADR-0011 item 1 the boot warning names config:import", () => {
  it("a changed site file still boots the stored version and the warning names the command", async () => {
    const file = imageFile();
    const env = testEnv({ SITE_CONFIG: file });
    const boot = async () => {
      const lines: Record<string, unknown>[] = [];
      const deps = await buildDeps({
        env,
        secrets: TEST_SECRETS,
        logSink: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
      });
      deps.db.$client.close();
      return lines;
    };
    await boot();
    const site = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    auditOff(site);
    writeFileSync(file, JSON.stringify(site));
    const warned = (await boot()).filter((l) => l.msg === "site config file ignored");
    expect(warned).toEqual([
      expect.objectContaining({
        level: "warn",
        site: "default",
        version: 1,
        fix: expect.stringContaining("config:import"),
      }),
    ]);
  });
});
