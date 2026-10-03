import {
  ApiErrorSchema,
  type AuditEvent,
  ConfigDocumentSchema,
  SubmitQueryResponseSchema,
  SYSTEM_ACTOR,
} from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { activate } from "../../src/admin/config/activate";
import { ConfigLoadError } from "../../src/config/load";
import { uuidv7 } from "../../src/ids";
import { createTestApp, type TestApp } from "../helpers/test-app";

/*
 * ADR-0011 item 3, spec 5.8 (overridden by ADR-0011), 6.7: publish activates a stored version in
 * process. One transaction marks it published (the previous one superseded) and writes
 * configLoaded with the caller's event; the snapshot swaps only after commit. A submit planned
 * before the swap commits on its own snapshot; a stale submit gets 409. BR-001, FR-064; ADR-0011 items 3 and 7.
 */

const PASSWORD = "correct-horse-battery-1";
const EMAIL = "implementer@example.test";

interface Row {
  id: string;
  version: number;
  status: string;
  document: string;
  config_hash: string | null;
  published_by: string | null;
  published_at: number | null;
}

async function rows(t: TestApp): Promise<Row[]> {
  const r = await t.deps.db.$client.execute(
    "SELECT id, version, status, document, config_hash, published_by, published_at FROM site_config_version ORDER BY version",
  );
  return r.rows.map((x) => ({ ...x }) as unknown as Row);
}

/** Inserts version 2 as a draft: the live document with one changed default, or `document`. */
async function insertDraft(
  t: TestApp,
  document?: string,
): Promise<{ id: string; version: number }> {
  const [live] = await rows(t);
  const doc = ConfigDocumentSchema.parse(JSON.parse(String(live?.document)));
  const changed = { ...doc, siteConfig: { ...doc.siteConfig, defaults: { state: "OK" } } };
  const id = uuidv7(t.clock.now());
  await t.deps.db.$client.execute({
    sql: "INSERT INTO site_config_version (id, site_id, version, status, document, created_by, created_at, base_version) VALUES (?, 'default', 2, 'draft', ?, 'system', ?, 1)",
    args: [id, document ?? JSON.stringify(changed), t.clock.now()],
  });
  return { id, version: 2 };
}

/** The caller's event (Task 27 passes configPublished); here a stub with fixed ids. */
function stubEvent(t: TestApp, versionId: string, configHash: string): AuditEvent {
  return {
    type: "configPublished",
    actor: { id: "01890a5d-ac96-774b-bcce-b302099a8001", email: EMAIL, role: "implementer" },
    identitySource: "local",
    details: {
      siteId: "default",
      versionId,
      version: 2,
      configHash,
      previousConfigHash: t.deps.config.current().configHash,
      changedPointers: ["/siteConfig/defaults"],
    },
  };
}

async function setup() {
  const t = await createTestApp();
  await t.createUser(EMAIL, PASSWORD);
  const cookie = await t.cookieFor(EMAIL, PASSWORD);
  const getConfig = async () =>
    (await (await t.request("/api/v1/config", { headers: { cookie } })).json()) as {
      configHash: string;
      defaults: Record<string, string>;
    };
  const submit = (configHash: string) =>
    t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        queryType: "VEH",
        values: { plate: "ZZ-0001" },
        sourceIds: ["stateSource", "nationalSource"],
        mode: "plateOnly",
        configHash,
      }),
    });
  return { t, getConfig, submit };
}

/** The stub event's hash: Task 27 computes the real one; activate passes the event through. */
const STUB_HASH = "0".repeat(64);

describe("BR-001 ADR-0011 publish activates a stored version live", () => {
  it("the next GET /api/v1/config serves the new hash; statuses and audit rows in one step", async () => {
    const { t, getConfig } = await setup();
    const before = await getConfig();
    const draft = await insertDraft(t);
    const loadedBefore = (await t.auditRows("configLoaded")).length;

    const t0 = t.clock.now();
    await activate(t.deps, draft.version, stubEvent(t, draft.id, STUB_HASH));
    const t1 = t.clock.now();

    const after = await getConfig();
    expect(after.configHash).not.toBe(before.configHash);
    expect(after.configHash).toBe(t.deps.config.current().configHash);
    expect(after.defaults).toEqual({ state: "OK" });
    const meta = (await (await t.request("/api/v1/meta")).json()) as { configHash: string };
    expect(meta.configHash).toBe(after.configHash);

    const [v1, v2] = await rows(t);
    expect(v1).toMatchObject({ version: 1, status: "superseded", config_hash: before.configHash });
    expect(v2).toMatchObject({
      version: 2,
      status: "published",
      config_hash: after.configHash,
      published_by: "01890a5d-ac96-774b-bcce-b302099a8001",
    });
    expect(Number(v2?.published_at)).toBeGreaterThanOrEqual(t0);
    expect(Number(v2?.published_at)).toBeLessThanOrEqual(t1);

    const loaded = await t.auditRows("configLoaded");
    expect(loaded).toHaveLength(loadedBefore + 1);
    expect(loaded.at(-1)).toMatchObject({
      actorUserId: SYSTEM_ACTOR.id,
      details: { siteId: "default", configHash: after.configHash, extendsChain: [] },
    });
    const published = await t.auditRows("configPublished");
    expect(published).toHaveLength(1);
    expect(published[0]?.id).toBe(Number(loaded.at(-1)?.id) + 1);
    expect(published[0]?.details).toMatchObject({ versionId: draft.id, version: 2 });
  });

  it("without a caller event, publishes by the system actor and writes configLoaded only", async () => {
    const { t } = await setup();
    const draft = await insertDraft(t);
    await activate(t.deps, draft.version);
    const [, v2] = await rows(t);
    expect(v2).toMatchObject({ status: "published", published_by: SYSTEM_ACTOR.id });
    expect(await t.auditRows("configPublished")).toEqual([]);
    expect((await t.auditRows("configLoaded")).at(-1)?.details.configHash).toBe(v2?.config_hash);
  });
});

describe("FR-064 spec 6.7 submits across an activation", () => {
  it("a submit carrying the old hash after the swap gets 409 configHashMismatch", async () => {
    const { t, getConfig, submit } = await setup();
    const old = (await getConfig()).configHash;
    await activate(t.deps, (await insertDraft(t)).version);
    const r = await submit(old);
    expect(r.status).toBe(409);
    const e = ApiErrorSchema.parse(await r.json()).error;
    expect(e.code).toBe("configHashMismatch");
    expect(e.params).toEqual({ currentConfigHash: t.deps.config.current().configHash });
  });

  it("a submit planned before the swap commits with the hash it was planned against", async () => {
    const { t, getConfig, submit } = await setup();
    const old = (await getConfig()).configHash;
    const draft = await insertDraft(t);

    // Test hook: hold the submit between prepare and T1 (its transaction has not begun yet).
    const db = t.deps.db;
    const original = db.transaction.bind(db);
    let reached!: () => void;
    const atT1 = new Promise<void>((r) => {
      reached = r;
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // Once the session has resolved (its limits read the holder too), prepare's read is the
    // next current(); the next transaction after that read is T1.
    const holder = t.deps.config;
    const read = holder.current.bind(holder);
    const current = vi.spyOn(holder, "current");
    const identity = t.deps.identity;
    const resolve = identity.resolveGated.bind(identity);
    const resolved = vi.spyOn(identity, "resolveGated").mockImplementationOnce(async (req) => {
      const p = await resolve(req);
      current.mockImplementationOnce(() => {
        vi.spyOn(db, "transaction").mockImplementationOnce(async (fn, config) => {
          reached();
          await gate;
          return original(fn, config);
        });
        return read();
      });
      return p;
    });
    const pending = submit(old);
    await atT1;
    resolved.mockRestore();
    current.mockRestore();
    vi.mocked(db.transaction).mockRestore();
    await activate(t.deps, draft.version);
    const fresh = t.deps.config.current().configHash;
    expect(fresh).not.toBe(old);
    release();

    const r = await pending;
    expect(r.status).toBe(202);
    const { correlationId } = SubmitQueryResponseSchema.parse(await r.json());
    const parts = await db.$client.execute({
      sql: "SELECT config_hash FROM query_request WHERE correlation_id = ?",
      args: [correlationId],
    });
    expect(parts.rows.map((p) => p.config_hash)).toEqual([old]);
    const submitted = await db.$client.execute({
      sql: "SELECT details FROM audit_event WHERE correlation_id = ? AND type = 'submitted'",
      args: [correlationId],
    });
    expect(
      submitted.rows.map(
        (s) => (JSON.parse(String(s.details)) as { configHash: string }).configHash,
      ),
    ).toEqual([old]);
  });
});

describe("spec 5.8 ADR-0011 item 2 a failed activation leaves the old snapshot live (fail closed)", () => {
  async function expectUnchanged(
    t: TestApp,
    before: Awaited<ReturnType<typeof rows>>,
    hash: string,
  ) {
    expect(t.deps.config.current().configHash).toBe(hash);
    expect(await rows(t)).toEqual(before);
  }

  it("an audit failure rolls back the statuses and keeps the old snapshot", async () => {
    const { t, getConfig } = await setup();
    const old = (await getConfig()).configHash;
    const draft = await insertDraft(t);
    const before = await rows(t);
    const loaded = (await t.auditRows("configLoaded")).length;
    vi.spyOn(t.deps.audit, "record").mockRejectedValueOnce(new Error("audit down"));
    await expect(activate(t.deps, draft.version)).rejects.toThrow("audit down");
    await expectUnchanged(t, before, old);
    expect((await getConfig()).configHash).toBe(old);
    expect(await t.auditRows("configLoaded")).toHaveLength(loaded);
  });

  it("an invalid caller event rolls back configLoaded with it", async () => {
    const { t } = await setup();
    const old = t.deps.config.current().configHash;
    const draft = await insertDraft(t);
    const before = await rows(t);
    const loaded = (await t.auditRows("configLoaded")).length;
    const bad = { ...stubEvent(t, draft.id, STUB_HASH), actor: SYSTEM_ACTOR };
    await expect(activate(t.deps, draft.version, bad)).rejects.toThrow(
      /written by an admin or implementer/,
    );
    await expectUnchanged(t, before, old);
    expect(await t.auditRows("configLoaded")).toHaveLength(loaded);
  });

  it("refuses a stored document that fails the chain, naming site and version only", async () => {
    const { t } = await setup();
    const old = t.deps.config.current().configHash;
    const [live] = await rows(t);
    const doc = JSON.parse(String(live?.document)) as { siteConfig: Record<string, unknown> };
    doc.siteConfig.queryTypes = "SECRET-LABEL";
    const draft = await insertDraft(t, JSON.stringify(doc));
    const before = await rows(t);
    const e = await activate(t.deps, draft.version).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConfigLoadError);
    expect(String((e as Error).message)).toContain("store site default version 2");
    expect(String((e as Error).message)).not.toContain("SECRET-LABEL");
    await expectUnchanged(t, before, old);
  });

  it("refuses stored text that is not JSON", async () => {
    const { t } = await setup();
    const draft = await insertDraft(t, "{not json");
    const before = await rows(t);
    await expect(activate(t.deps, draft.version)).rejects.toThrow("config.invalidJson");
    await expectUnchanged(t, before, t.deps.config.current().configHash);
  });

  it("refuses a document for another site", async () => {
    const { t } = await setup();
    const [live] = await rows(t);
    const doc = ConfigDocumentSchema.parse(JSON.parse(String(live?.document)));
    const site = { ...(doc.siteConfig.site as object), id: "other" };
    // The mock file names the same site, so the site id check itself refuses it.
    const mock = { ...(doc.mock as object), siteId: "other" };
    const other = { ...doc, siteConfig: { ...doc.siteConfig, site }, mock };
    const draft = await insertDraft(t, JSON.stringify(other));
    const before = await rows(t);
    await expect(activate(t.deps, draft.version)).rejects.toThrow("config.siteMismatch");
    await expectUnchanged(t, before, t.deps.config.current().configHash);
  });

  it("refuses a draft with auth.mfaRequired set, as the startup guard would (#216)", async () => {
    const { t } = await setup();
    const [live] = await rows(t);
    const doc = ConfigDocumentSchema.parse(JSON.parse(String(live?.document)));
    const auth = { ...(doc.siteConfig.auth as object), mfaRequired: true };
    const draft = await insertDraft(
      t,
      JSON.stringify({ ...doc, siteConfig: { ...doc.siteConfig, auth } }),
    );
    const before = await rows(t);
    const hash = t.deps.config.current().configHash;
    const loaded = (await t.auditRows("configLoaded")).length;
    const e = await activate(t.deps, draft.version, stubEvent(t, draft.id, STUB_HASH)).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ConfigLoadError);
    expect(String((e as Error).message)).toContain("config.mfaNotEnforced");
    await expectUnchanged(t, before, hash);
    expect(await t.auditRows("configLoaded")).toHaveLength(loaded);
    expect(await t.auditRows("configPublished")).toEqual([]);
  });

  it("refuses an unknown version and a version that is not a draft", async () => {
    const { t } = await setup();
    const before = await rows(t);
    const hash = t.deps.config.current().configHash;
    await expect(activate(t.deps, 9)).rejects.toThrow("config.versionNotFound");
    await expect(activate(t.deps, 1)).rejects.toThrow("config.versionNotDraft");
    await expectUnchanged(t, before, hash);
  });

  it("refuses when the draft changed after it was validated", async () => {
    const { t } = await setup();
    const draft = await insertDraft(t);
    const before = await rows(t);
    const hash = t.deps.config.current().configHash;
    const db = t.deps.db;
    const original = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(async (fn, config) => {
      await db.$client.execute({
        sql: "UPDATE site_config_version SET document = ? WHERE version = 2",
        args: [`${String(before[1]?.document)} `],
      });
      return original(fn, config);
    });
    await expect(activate(t.deps, draft.version)).rejects.toThrow("config.versionChanged");
    expect(t.deps.config.current().configHash).toBe(hash);
    const after = await rows(t);
    expect(after.map((r) => r.status)).toEqual(["published", "draft"]);
  });
});

/** The live stored document with `edit` applied to its siteConfig, as draft version 2. */
async function insertEdited(
  t: TestApp,
  edit: (sc: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ id: string; version: number }> {
  const [live] = await rows(t);
  const doc = ConfigDocumentSchema.parse(JSON.parse(String(live?.document)));
  const siteConfig = edit(doc.siteConfig as unknown as Record<string, unknown>);
  return insertDraft(t, JSON.stringify({ ...doc, siteConfig }));
}

describe("spec 5.9 spec 5.6 readers that outlive the boot snapshot (critic C1)", () => {
  it("a field key added by a published version is redacted at once, in children made before", async () => {
    const { t } = await setup();
    const early = t.deps.logger.child({ req: "early" });
    const draft = await insertEdited(t, (sc) => ({
      ...sc,
      queryTypes: (sc.queryTypes as { code: string; fields: unknown[] }[]).map((q) =>
        q.code === "WNT"
          ? {
              ...q,
              fields: [
                ...q.fields,
                { key: "probeKey", labelKey: "field.first", dataType: "string" },
              ],
            }
          : q,
      ),
    }));
    t.deps.logger.info("before", { probeKey: "ZZ-PRE-0001" });
    expect(t.logLines.join("\n")).toContain("ZZ-PRE-0001");
    await activate(t.deps, draft.version);
    t.deps.logger.info("root", { probeKey: "ZZ-PROBE-0001" });
    early.info("child", { probeKey: "ZZ-PROBE-0002" });
    t.deps.logger.child({ req: "late" }).info("late", { probekey: "ZZ-PROBE-0003" });
    expect(t.logLines.join("\n")).not.toMatch(/ZZ-PROBE-/);
  });

  it("session limits from a published version apply to the next request", async () => {
    const { t } = await setup();
    const draft = await insertEdited(t, (sc) => ({
      ...sc,
      auth: { ...(sc.auth as object), session: { absoluteMinutes: 720, idleMinutes: 5 } },
    }));
    await activate(t.deps, draft.version);
    const cookie = await t.cookieFor(EMAIL, PASSWORD);
    t.clock.advance(10 * 60_000);
    const r = await t.request("/api/v1/config", { headers: { cookie } });
    expect(r.status).toBe(401);
  });
});
