import {
  AdminConfigResponseSchema,
  ConfigVersionSchema,
  MAX_CHANGED_POINTERS,
} from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { activate } from "../../src/admin/config/activate";
import { changedPointers } from "../../src/admin/config/publish";
import { API, adminConfigApp, errorOf, withSiteConfig } from "../helpers/admin-config";

/*
 * ADR-0011 items 3, 5 and 7: publish validates the draft, refuses any error, and activates it
 * through activate() as the next version, writing configPublished (JSON pointers only, never
 * values) and configLoaded in the same transaction. Rollback republishes an older document as
 * a new version with rollbackOf; history is never rewritten. BR-001.
 */

/** A value no config holds, so its absence from the audit row is meaningful. */
const MARK = "ZZMARKAGENCY";

async function publishedDraft() {
  const a = await adminConfigApp();
  const v1 = await a.exportVersion(1);
  const edited = withSiteConfig(v1, (s) => {
    s.defaults = { ...(s.defaults as Record<string, string>), agency: MARK };
  });
  const put = await a.call("implementer", "PUT", `${API}/draft`, {
    baseVersion: 1,
    document: edited,
  });
  expect(put.status).toBe(200);
  return { a, v1, edited };
}

describe("BR-001 ADR-0011 items 3 and 5 publish", () => {
  it("publishes the draft as version n+1 with configPublished (pointers, no values) and configLoaded", async () => {
    const { a } = await publishedDraft();
    const before = a.t.deps.config.current().configHash;
    const loadedBefore = (await a.t.auditRows("configLoaded")).length;

    const r = await a.call("implementer", "POST", `${API}/publish`, { draftVersion: 2 });
    expect(r.status).toBe(200);
    const implementer = await a.userId("implementer");
    const published = ConfigVersionSchema.parse(await r.json());
    expect(published).toMatchObject({
      version: 2,
      status: "published",
      baseVersion: 1,
      publishedBy: implementer,
      rollbackOf: null,
    });
    const after = a.t.deps.config.current().configHash;
    expect(after).not.toBe(before);
    expect(published.configHash).toBe(after);
    expect(a.t.deps.config.current().siteConfig.defaults.agency).toBe(MARK);

    const rows = await a.t.auditRows("configPublished");
    expect(rows).toEqual([
      {
        id: rows[0]?.id,
        actorUserId: implementer,
        details: {
          siteId: "default",
          versionId: published.id,
          version: 2,
          configHash: after,
          previousConfigHash: before,
          changedPointers: ["/siteConfig/defaults/agency"],
        },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain(MARK);
    expect(JSON.stringify(rows)).not.toContain("EXAMPLEPD");
    const loaded = await a.t.auditRows("configLoaded");
    expect(loaded).toHaveLength(loadedBefore + 1);
    expect(loaded.at(-1)?.details.configHash).toBe(after);
    expect(a.t.logLines.join("\n")).not.toContain(MARK);

    expect((await a.versionRows()).map((v) => [v.version, v.status])).toEqual([
      [1, "superseded"],
      [2, "published"],
    ]);
    const shell = await (await a.call("user", "GET", "/api/v1/config")).json();
    expect((shell as { configHash: string }).configHash).toBe(after);
    const body = AdminConfigResponseSchema.parse(await (await a.call("admin", "GET", API)).json());
    expect(body.live.version).toBe(2);
    expect(body.draft).toBeNull();
  });

  it("a published or missing draft version is 404 notFound", async () => {
    const { a } = await publishedDraft();
    expect((await a.call("admin", "POST", `${API}/publish`, { draftVersion: 2 })).status).toBe(200);
    for (const draftVersion of [1, 2, 9]) {
      const r = await a.call("admin", "POST", `${API}/publish`, { draftVersion });
      expect(r.status, String(draftVersion)).toBe(404);
      expect((await errorOf(r)).code).toBe("notFound");
    }
    expect(await a.t.auditRows("configPublished")).toHaveLength(1);
  });

  it("a draft whose base is no longer live is 409 draftConflict; a save on the new base replaces it", async () => {
    const { a, edited } = await publishedDraft();
    // Rollback to version 1 publishes version 3; the draft (version 2) still names base 1.
    expect((await a.call("admin", "POST", `${API}/versions/1/rollback`)).status).toBe(200);
    const hash = a.t.deps.config.current().configHash;
    const r = await a.call("implementer", "POST", `${API}/publish`, { draftVersion: 2 });
    expect(r.status).toBe(409);
    expect((await errorOf(r)).code).toBe("draftConflict");
    expect(a.t.deps.config.current().configHash).toBe(hash);
    expect(await a.t.auditRows("configPublished")).toHaveLength(1);

    const stale = await a.call("implementer", "PUT", `${API}/draft`, {
      baseVersion: 1,
      document: edited,
    });
    expect(stale.status).toBe(409);
    const put = await a.call("implementer", "PUT", `${API}/draft`, {
      baseVersion: 3,
      document: edited,
    });
    expect(put.status).toBe(200);
    // The draft moves above the live version, so history stays in version order.
    expect(ConfigVersionSchema.parse(await put.json())).toMatchObject({
      version: 4,
      baseVersion: 3,
    });
    expect((await a.versionRows()).map((v) => [v.version, v.status])).toEqual([
      [1, "superseded"],
      [3, "published"],
      [4, "draft"],
    ]);
    expect(
      (await a.call("implementer", "POST", `${API}/publish`, { draftVersion: 4 })).status,
    ).toBe(200);
  });

  it("an MFA-required draft is 400 validationFailed: no audit row, no status change, old snapshot live", async () => {
    const a = await adminConfigApp();
    const doc = withSiteConfig(await a.exportVersion(1), (s) => {
      s.auth = { ...(s.auth as Record<string, unknown>), mfaRequired: true };
    });
    await a.call("admin", "PUT", `${API}/draft`, { baseVersion: 1, document: doc });
    const hash = a.t.deps.config.current().configHash;
    const loaded = (await a.t.auditRows("configLoaded")).length;
    const r = await a.call("admin", "POST", `${API}/publish`, { draftVersion: 2 });
    expect(r.status).toBe(400);
    const e = await errorOf(r);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toContainEqual({
      key: "config.mfaNotEnforced",
      params: { path: "/auth/mfaRequired" },
    });
    expect(a.t.deps.config.current().configHash).toBe(hash);
    expect(await a.t.auditRows("configPublished")).toEqual([]);
    expect(await a.t.auditRows("configLoaded")).toHaveLength(loaded);
    expect((await a.versionRows()).map((v) => v.status)).toEqual(["published", "draft"]);
  });
});

describe("ADR-0011 items 3 and 5 rollback", () => {
  it("rollback to version 1 publishes version n+2 with rollbackOf 1 and never rewrites version 1", async () => {
    const { a, v1 } = await publishedDraft();
    const original = (await a.versionRows())[0];
    const firstHash = original?.configHash;
    expect((await a.call("admin", "POST", `${API}/publish`, { draftVersion: 2 })).status).toBe(200);
    const v2Hash = a.t.deps.config.current().configHash;

    const r = await a.call("implementer", "POST", `${API}/versions/1/rollback`);
    expect(r.status).toBe(200);
    const implementer = await a.userId("implementer");
    const rolled = ConfigVersionSchema.parse(await r.json());
    expect(rolled).toMatchObject({
      version: 3,
      status: "published",
      rollbackOf: 1,
      baseVersion: 2,
      configHash: firstHash,
      createdBy: implementer,
      publishedBy: implementer,
    });
    expect(a.t.deps.config.current().configHash).toBe(firstHash);
    expect(await a.exportVersion(3)).toEqual(v1);

    const rows = await a.versionRows();
    expect(rows.map((v) => [v.version, v.status, v.rollbackOf])).toEqual([
      [1, "superseded", null],
      [2, "superseded", null],
      [3, "published", 1],
    ]);
    expect(rows[0]).toEqual(original && { ...original, status: "superseded" });

    const audit = await a.t.auditRows("configPublished");
    expect(audit.at(-1)).toEqual({
      id: audit.at(-1)?.id,
      actorUserId: implementer,
      details: {
        siteId: "default",
        versionId: rolled.id,
        version: 3,
        configHash: firstHash,
        previousConfigHash: v2Hash,
        changedPointers: ["/siteConfig/defaults/agency"],
        rollbackOf: 1,
      },
    });
    expect(JSON.stringify(audit)).not.toContain(MARK);
  });

  it("rollback of a draft is 404 and leaves the draft as it is", async () => {
    const { a } = await publishedDraft();
    const r = await a.call("admin", "POST", `${API}/versions/2/rollback`);
    expect(r.status).toBe(404);
    expect((await a.versionRows()).map((v) => [v.version, v.status])).toEqual([
      [1, "published"],
      [2, "draft"],
    ]);
  });
});

describe("ADR-0011 items 3 and 5 activate checks the live version and the draft inside its transaction", () => {
  it("a live version other than the expected one refuses the publish and changes nothing", async () => {
    const { a } = await publishedDraft();
    const hash = a.t.deps.config.current().configHash;
    const document = (await a.versionRows())[1]?.document ?? "";
    await expect(activate(a.t.deps, 2, undefined, { live: 7, document })).rejects.toThrow(
      /config\.liveChanged/,
    );
    expect(a.t.deps.config.current().configHash).toBe(hash);
    expect((await a.versionRows()).map((v) => v.status)).toEqual(["published", "draft"]);
  });

  it("a draft other than the validated document refuses the publish and changes nothing (critic:C1)", async () => {
    const { a, v1 } = await publishedDraft();
    const hash = a.t.deps.config.current().configHash;
    const loaded = (await a.t.auditRows("configLoaded")).length;
    const stale = { live: 1, document: JSON.stringify(v1) };
    await expect(activate(a.t.deps, 2, undefined, stale)).rejects.toThrow(/config\.versionChanged/);
    expect(a.t.deps.config.current().configHash).toBe(hash);
    expect((await a.versionRows()).map((v) => v.status)).toEqual(["published", "draft"]);
    expect(await a.t.auditRows("configLoaded")).toHaveLength(loaded);
  });
});

describe("ADR-0011 item 7 changedPointers (writer rule)", () => {
  it("names changed, added and removed leaves by pointer, never by value", () => {
    expect(
      changedPointers(
        { a: { b: 1, c: [1, 2] }, d: "x", gone: true },
        { a: { b: 2, c: [1, 2, 3] }, d: "x", added: { deep: 1 } },
      ),
    ).toEqual(["/a/b", "/a/c/2", "/added", "/gone"]);
    expect(changedPointers({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it("escapes ~ and /, and records a key outside the pointer grammar as its parent", () => {
    expect(changedPointers({ m: { "a/b": 1, "c~d": 1 } }, { m: { "a/b": 2, "c~d": 2 } })).toEqual([
      "/m/a~1b",
      "/m/c~0d",
    ]);
    expect(
      changedPointers(
        { roleClaims: { "urn:x:secret value": "a", ok: 1 } },
        { roleClaims: { "urn:x:secret value": "b", ok: 2 } },
      ),
    ).toEqual(["/roleClaims"]);
  });

  it("collapses to parents until at most MAX_CHANGED_POINTERS remain", () => {
    const many = (v: number) =>
      Object.fromEntries(
        Array.from({ length: 3 }, (_, g) => [
          `g${g}`,
          Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`k${i}`, v])),
        ]),
      );
    const out = changedPointers(many(1), many(2));
    expect(out.length).toBeLessThanOrEqual(MAX_CHANGED_POINTERS);
    expect(out).toEqual(["/g0", "/g1", "/g2"]);
  });
});
