import {
  type ConfigDocument,
  ConfigVersionSchema,
  ValidateConfigResponseSchema,
} from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { activate } from "../../src/admin/config/activate";
import { uuidv7 } from "../../src/ids";
import {
  type AdminConfigApp,
  API,
  adminConfigApp,
  errorOf,
  withSiteConfig,
} from "../helpers/admin-config";

/*
 * #511 T27 IC1 (spec 5.4, 10.8; ADR-0011 items 2, 3 and 5): the admin config API holds
 * document.mock to the fixture policy. Validate answers each finding as a fixture.* diagnostic at
 * its /mock pointer; draft save refuses a document with any finding (nothing stored); publish and
 * rollback refuse it with no version change and no configPublished row. Bad values here are
 * synthetic-looking stand-ins (last "SMITH"), never real records.
 */

type Json = Record<string, unknown>;
interface MockShape {
  sources: Record<string, { responses: { queryType: string; default: Json }[] }>;
}

const BAD_NAME = "SMITH";

/** A copy of `doc` whose PER default payload carries last: "SMITH", and the finding's pointer. */
function withBadName(doc: ConfigDocument): { document: ConfigDocument; path: string } {
  const document = structuredClone(doc);
  const mock = document.mock as unknown as MockShape;
  for (const [sourceId, source] of Object.entries(mock.sources)) {
    const i = source.responses.findIndex((r) => r.queryType === "PER");
    const resp = source.responses[i];
    if (!resp) continue;
    resp.default = { ...resp.default, last: BAD_NAME };
    return { document, path: `/mock/sources/${sourceId}/responses/${i}/default/last` };
  }
  throw new Error("no PER mock response");
}

const FINDING = "fixture.nonSyntheticName";

/** Inserts `document` as draft `version` on `base`, outside the API (the store holding one). */
async function insertDraft(a: AdminConfigApp, version: number, base: number, document: string) {
  await a.t.deps.db.$client.execute({
    sql: `INSERT INTO site_config_version (id, site_id, version, status, document, base_version, created_by, created_at)
          SELECT ?, site_id, ?, 'draft', ?, ?, created_by, created_at FROM site_config_version WHERE version = 1`,
    args: [uuidv7(), version, document, base],
  });
}

describe("#511 T27 IC1 validate applies the fixture policy to document.mock", () => {
  it("the shipped default document validates clean", async () => {
    const a = await adminConfigApp();
    const doc = await a.exportVersion(1);
    expect(doc.mock).toBeDefined();
    const r = await a.call("implementer", "POST", `${API}/validate`, { document: doc });
    expect(r.status).toBe(200);
    expect(ValidateConfigResponseSchema.parse(await r.json()).errors).toEqual([]);
  });

  it("a non-synthetic name is one fixture diagnostic at its /mock pointer, never its value", async () => {
    const a = await adminConfigApp();
    const { document, path } = withBadName(await a.exportVersion(1));
    const r = await a.call("implementer", "POST", `${API}/validate`, { document });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(BAD_NAME);
    expect(ValidateConfigResponseSchema.parse(JSON.parse(text)).errors).toEqual([
      { level: "error", path, key: FINDING, params: {} },
    ]);
  });

  it("the finding is answered alongside the errors of a failing chain step", async () => {
    const a = await adminConfigApp();
    const { document, path } = withBadName(await a.exportVersion(1));
    const bad = withSiteConfig(document, (s) => {
      (s.sources as Json[])[0] = { ...(s.sources as Json[])[0], kind: "noSuchKind" };
    });
    const r = await a.call("implementer", "POST", `${API}/validate`, { document: bad });
    const { errors } = ValidateConfigResponseSchema.parse(await r.json());
    expect(errors).toContainEqual(
      expect.objectContaining({ path: "/sources/0/kind", key: "config.unknownAdapterKind" }),
    );
    expect(errors).toContainEqual({ level: "error", path, key: FINDING, params: {} });
  });

  it("critic C1: a schema-invalid mock fails closed even when the chain never reaches the mock", async () => {
    const a = await adminConfigApp();
    const document = structuredClone(await a.exportVersion(1));
    (document.mock as Json).extra = { last: BAD_NAME };
    // An unknown adapter kind stops the chain before its mock step: the mock is never parsed there.
    const bad = withSiteConfig(document, (s) => {
      for (const src of s.sources as Json[]) src.kind = "noSuchKind";
    });
    const r = await a.call("implementer", "POST", `${API}/validate`, { document: bad });
    const text = await r.text();
    expect(text).not.toContain(BAD_NAME);
    const { errors } = ValidateConfigResponseSchema.parse(JSON.parse(text));
    expect(errors).toContainEqual({
      level: "error",
      path: "/mock",
      key: "config.mockSchema",
      params: { code: "unrecognized_keys", file: "default.json" },
    });
  });

  it("critic C1: the chain's own config.mockSchema is not reported twice", async () => {
    const a = await adminConfigApp();
    const document = structuredClone(await a.exportVersion(1));
    (document.mock as Json).extra = { last: BAD_NAME };
    const r = await a.call("implementer", "POST", `${API}/validate`, { document });
    const { errors } = ValidateConfigResponseSchema.parse(await r.json());
    expect(errors.filter((e) => e.key === "config.mockSchema")).toHaveLength(1);
  });
});

describe("#511 T27 IC1 draft save refuses a fixture finding", () => {
  it("saving a document with a fixture finding is 400 validationFailed and stores nothing", async () => {
    const a = await adminConfigApp();
    const { document, path } = withBadName(await a.exportVersion(1));
    const r = await a.call("implementer", "PUT", `${API}/draft`, { baseVersion: 1, document });
    expect(r.status).toBe(400);
    const text = await r.text();
    expect(text).not.toContain(BAD_NAME);
    const e = await errorOf(new Response(text));
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toEqual([{ key: FINDING, params: { path } }]);
    const rows = await a.versionRows();
    expect(rows.map((v) => [v.version, v.status])).toEqual([[1, "published"]]);
    expect(JSON.stringify(rows)).not.toContain(BAD_NAME);
    expect(a.t.logLines.join("\n")).not.toContain(BAD_NAME);
  });

  it("a mock that fails MockFileSchema is refused as config.mockSchema and stores nothing (ruling IC1)", async () => {
    const a = await adminConfigApp();
    const document = structuredClone(await a.exportVersion(1));
    // An unknown root key: the strict MockFileSchema fails, so the policy walk cannot reach it.
    (document.mock as Json).extra = { last: BAD_NAME };
    const r = await a.call("implementer", "PUT", `${API}/draft`, { baseVersion: 1, document });
    expect(r.status).toBe(400);
    const text = await r.text();
    expect(text).not.toContain(BAD_NAME);
    const e = await errorOf(new Response(text));
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toEqual([
      { key: "config.mockSchema", params: { path: "/mock", code: "unrecognized_keys" } },
    ]);
    const rows = await a.versionRows();
    expect(rows.map((v) => [v.version, v.status])).toEqual([[1, "published"]]);
    expect(JSON.stringify(rows)).not.toContain(BAD_NAME);
    expect(a.t.logLines.join("\n")).not.toContain(BAD_NAME);
  });

  it("a draft with a non-fixture validation error still saves", async () => {
    const a = await adminConfigApp();
    const bad = withSiteConfig(await a.exportVersion(1), (s) => {
      (s.sources as Json[])[0] = { ...(s.sources as Json[])[0], labelKey: "source.noSuchLabel" };
    });
    const v = await a.call("implementer", "POST", `${API}/validate`, { document: bad });
    const { errors } = ValidateConfigResponseSchema.parse(await v.json());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((d) => d.key.startsWith("fixture."))).toEqual([]);
    const r = await a.call("implementer", "PUT", `${API}/draft`, { baseVersion: 1, document: bad });
    expect(r.status).toBe(200);
    expect(ConfigVersionSchema.parse(await r.json())).toMatchObject({
      version: 2,
      status: "draft",
    });
  });
});

describe("#511 T27 IC1 publish and rollback refuse a fixture finding", () => {
  it("publish of a violating draft (stored outside the API) is 400: no version change, no audit row", async () => {
    const a = await adminConfigApp();
    const { document, path } = withBadName(await a.exportVersion(1));
    await insertDraft(a, 2, 1, JSON.stringify(document));
    const hash = a.t.deps.config.current().configHash;
    const loaded = (await a.t.auditRows("configLoaded")).length;
    const r = await a.call("admin", "POST", `${API}/publish`, { draftVersion: 2 });
    expect(r.status).toBe(400);
    const e = await errorOf(r);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toEqual([{ key: FINDING, params: { path } }]);
    expect(a.t.deps.config.current().configHash).toBe(hash);
    expect(await a.t.auditRows("configPublished")).toEqual([]);
    expect(await a.t.auditRows("configLoaded")).toHaveLength(loaded);
    expect((await a.versionRows()).map((v) => [v.version, v.status])).toEqual([
      [1, "published"],
      [2, "draft"],
    ]);
  });

  it("rollback to a stored version that violates is 400 and leaves no new row", async () => {
    const a = await adminConfigApp();
    const v1 = await a.exportVersion(1);
    const { document, path } = withBadName(v1);
    // A violating version 2 and a clean version 3, published outside the API (activate()
    // directly, as an operator would): the only way the store can hold one.
    const bad = JSON.stringify(document);
    await insertDraft(a, 2, 1, bad);
    await activate(a.t.deps, 2, undefined, { live: 1, document: bad });
    const clean = JSON.stringify(v1);
    await insertDraft(a, 3, 2, clean);
    await activate(a.t.deps, 3, undefined, { live: 2, document: clean });
    const hash = a.t.deps.config.current().configHash;
    const r = await a.call("admin", "POST", `${API}/versions/2/rollback`);
    expect(r.status).toBe(400);
    const e = await errorOf(r);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toEqual([{ key: FINDING, params: { path } }]);
    expect(a.t.deps.config.current().configHash).toBe(hash);
    expect(await a.t.auditRows("configPublished")).toEqual([]);
    expect((await a.versionRows()).map((v) => [v.version, v.status])).toEqual([
      [1, "superseded"],
      [2, "superseded"],
      [3, "published"],
    ]);
  });
});
