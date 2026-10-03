import {
  AdminConfigResponseSchema,
  ConfigVersionListSchema,
  ConfigVersionSchema,
  ValidateConfigResponseSchema,
} from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { API, adminConfigApp, errorOf, withSiteConfig } from "../helpers/admin-config";

/*
 * ADR-0011 items 1, 2, 4 and 5: one shared draft per site with an optimistic lock on the base
 * version; validate runs the spec 5.8 chain and answers diagnostics at JSON pointers; export
 * returns a version's document, and importing it as a draft round-trips unchanged. BR-001.
 */

type Json = Record<string, unknown>;

/** The first field that names a picklist, with its pointer into the site config. */
function picklistField(siteConfig: Json): { field: Json; pointer: string } {
  const types = siteConfig.queryTypes as { fields: Json[] }[];
  for (const [q, qt] of types.entries())
    for (const [f, field] of qt.fields.entries())
      if (typeof field.picklist === "string")
        return { field, pointer: `/queryTypes/${q}/fields/${f}/picklist` };
  throw new Error("no picklist field");
}

describe("BR-001 ADR-0011 draft save", () => {
  it("GET answers the live version with its document and no draft", async () => {
    const a = await adminConfigApp();
    const r = await a.call("implementer", "GET", API);
    expect(r.status).toBe(200);
    const body = AdminConfigResponseSchema.parse(await r.json());
    expect(body.siteId).toBe("default");
    expect(body.live).toMatchObject({ version: 1, status: "published", rollbackOf: null });
    expect(body.live.configHash).toBe(a.t.deps.config.current().configHash);
    expect(body.draft).toBeNull();
  });

  it("saves the shared draft as the next version on the live base; a second save updates it", async () => {
    const a = await adminConfigApp();
    const doc = await a.exportVersion(1);
    const edited = withSiteConfig(doc, (s) => {
      s.defaults = { state: "OK", agency: "EXAMPLEPD" };
    });
    const r = await a.call("implementer", "PUT", `${API}/draft`, {
      baseVersion: 1,
      document: edited,
    });
    expect(r.status).toBe(200);
    const saved = ConfigVersionSchema.parse(await r.json());
    expect(saved).toMatchObject({
      version: 2,
      status: "draft",
      baseVersion: 1,
      configHash: null,
      createdBy: await a.userId("implementer"),
      publishedBy: null,
      rollbackOf: null,
    });
    const again = await a.call("admin", "PUT", `${API}/draft`, { baseVersion: 1, document: doc });
    expect(again.status).toBe(200);
    expect(ConfigVersionSchema.parse(await again.json())).toMatchObject({
      id: saved.id,
      version: 2,
      createdBy: await a.userId("admin"),
    });
    const body = AdminConfigResponseSchema.parse(await (await a.call("admin", "GET", API)).json());
    expect(body.draft?.document).toEqual(doc);
    // Drafts are not audited (ADR-0011 item 7) and never change the live config.
    expect(await a.t.auditRows("configPublished")).toEqual([]);
    expect((await a.versionRows()).map((v) => [v.version, v.status])).toEqual([
      [1, "published"],
      [2, "draft"],
    ]);
  });

  it("a stale baseVersion is 409 draftConflict and writes nothing", async () => {
    const a = await adminConfigApp();
    const doc = await a.exportVersion(1);
    for (const baseVersion of [2, 7]) {
      const r = await a.call("implementer", "PUT", `${API}/draft`, { baseVersion, document: doc });
      expect(r.status).toBe(409);
      expect((await errorOf(r)).code).toBe("draftConflict");
    }
    expect(await a.versionRows()).toHaveLength(1);
  });

  it("a malformed body is 400 validationFailed", async () => {
    const a = await adminConfigApp();
    for (const body of [
      "{",
      {},
      { baseVersion: 1 },
      { baseVersion: 0, document: { siteConfig: {}, locales: {} } },
      { baseVersion: 1, document: { siteConfig: {}, locales: {}, extra: 1 } },
    ]) {
      const r = await a.call("admin", "PUT", `${API}/draft`, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect((await errorOf(r)).code).toBe("validationFailed");
    }
  });
});

describe("BR-001 ADR-0011 validate", () => {
  it("the live document validates clean", async () => {
    const a = await adminConfigApp();
    const r = await a.call("implementer", "POST", `${API}/validate`, {
      document: await a.exportVersion(1),
    });
    expect(r.status).toBe(200);
    expect(ValidateConfigResponseSchema.parse(await r.json()).errors).toEqual([]);
  });

  it("a dangling picklist reference is an error at its pointer; the draft saves but cannot publish", async () => {
    const a = await adminConfigApp();
    let at = "";
    const bad = withSiteConfig(await a.exportVersion(1), (s) => {
      const { field, pointer } = picklistField(s);
      field.picklist = "noSuchPicklist";
      at = pointer;
    });
    const r = await a.call("implementer", "POST", `${API}/validate`, { document: bad });
    expect(r.status).toBe(200);
    const { errors } = ValidateConfigResponseSchema.parse(await r.json());
    expect(errors).toContainEqual(
      expect.objectContaining({ level: "error", path: at, key: "config.unknownPicklist" }),
    );
    const put = await a.call("implementer", "PUT", `${API}/draft`, {
      baseVersion: 1,
      document: bad,
    });
    expect(put.status).toBe(200);
    const hash = a.t.deps.config.current().configHash;
    const pub = await a.call("implementer", "POST", `${API}/publish`, { draftVersion: 2 });
    expect(pub.status).toBe(400);
    const e = await errorOf(pub);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toContainEqual({ key: "config.unknownPicklist", params: { path: at } });
    expect(a.t.deps.config.current().configHash).toBe(hash);
    expect(await a.t.auditRows("configPublished")).toEqual([]);
    expect((await a.versionRows()).map((v) => [v.version, v.status])).toEqual([
      [1, "published"],
      [2, "draft"],
    ]);
  });

  it("server-only checks: an unknown adapter kind, a missing mock response and mfaRequired", async () => {
    const a = await adminConfigApp();
    const doc = await a.exportVersion(1);
    const kind = withSiteConfig(doc, (s) => {
      (s.sources as Json[])[0] = { ...(s.sources as Json[])[0], kind: "noSuchKind" };
    });
    const noMock = { ...doc, mock: { ...doc.mock, sources: {} } };
    const mfa = withSiteConfig(doc, (s) => {
      s.auth = { ...(s.auth as Json), mfaRequired: true };
    });
    const cases = [
      [kind, "/sources/0/kind", "config.unknownAdapterKind"],
      [noMock, "/sources/0/id", "config.missingMock"],
      [mfa, "/auth/mfaRequired", "config.mfaNotEnforced"],
    ] as const;
    for (const [document, path, key] of cases) {
      const r = await a.call("admin", "POST", `${API}/validate`, { document });
      const { errors } = ValidateConfigResponseSchema.parse(await r.json());
      expect(errors, key).toContainEqual(expect.objectContaining({ path, key }));
    }
  });
});

describe("ADR-0011 items 3 and 5 versions and export", () => {
  it("export round-trips through draft save unchanged", async () => {
    const a = await adminConfigApp();
    const r = await a.call("implementer", "GET", `${API}/versions/1/export`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    const exported = await r.json();
    const put = await a.call("implementer", "PUT", `${API}/draft`, {
      baseVersion: 1,
      document: exported,
    });
    expect(put.status).toBe(200);
    const body = AdminConfigResponseSchema.parse(await (await a.call("admin", "GET", API)).json());
    expect(body.draft?.document).toEqual(exported);
    expect(body.live.document).toEqual(exported);
    expect(await a.exportVersion(2)).toEqual(exported);
  });

  it("export and rollback of a missing version are 404; a malformed one is 400", async () => {
    const a = await adminConfigApp();
    for (const [method, suffix] of [
      ["GET", "export"],
      ["POST", "rollback"],
    ] as const) {
      const missing = await a.call("admin", method, `${API}/versions/9/${suffix}`);
      expect(missing.status, suffix).toBe(404);
      expect((await errorOf(missing)).code).toBe("notFound");
      for (const v of ["0", "x", "-1"]) {
        const bad = await a.call("admin", method, `${API}/versions/${v}/${suffix}`);
        expect(bad.status, `${suffix} ${v}`).toBe(400);
        expect((await errorOf(bad)).code).toBe("validationFailed");
      }
    }
  });

  it("lists versions newest first", async () => {
    const a = await adminConfigApp();
    await a.call("admin", "PUT", `${API}/draft`, {
      baseVersion: 1,
      document: await a.exportVersion(1),
    });
    const r = await a.call("implementer", "GET", `${API}/versions`);
    expect(r.status).toBe(200);
    const { versions } = ConfigVersionListSchema.parse(await r.json());
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, "draft"],
      [1, "published"],
    ]);
  });
});
