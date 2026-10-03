import { describe, expect, it, vi } from "vitest";
import { ConfigLoadError } from "../../src/config/load";
import { API, adminConfigApp, errorOf, withSiteConfig } from "../helpers/admin-config";

/*
 * ADR-0011 items 3, 5 and 7: activate() can still refuse after publish or rollback has
 * validated (a save, publish or rollback committed in between). The refusal maps to an API
 * answer, leaves the old snapshot live and writes no audit row; a rollback removes the version
 * row it inserted (still a draft, never history).
 */

const refuse = vi.hoisted(() => ({
  next: undefined as Error | undefined,
  before: undefined as (() => Promise<void>) | undefined,
  after: undefined as (() => void) | undefined,
}));
vi.mock("../../src/admin/config/activate", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/admin/config/activate")>();
  return {
    activate: async (...args: Parameters<typeof m.activate>) => {
      const e = refuse.next;
      const before = refuse.before;
      const after = refuse.after;
      refuse.next = undefined;
      refuse.before = undefined;
      refuse.after = undefined;
      if (e) throw e;
      if (before) await before();
      const r = await m.activate(...args);
      if (after) after();
      return r;
    },
  };
});

const loadError = (path: string, reason: string) => new ConfigLoadError("store", path, reason);

async function withDraft() {
  const a = await adminConfigApp();
  const doc = withSiteConfig(await a.exportVersion(1), (s) => {
    s.defaults = { state: "OK", agency: "EXAMPLEPD" };
  });
  expect(
    (await a.call("admin", "PUT", `${API}/draft`, { baseVersion: 1, document: doc })).status,
  ).toBe(200);
  return a;
}

describe("ADR-0011 items 3 and 5 activate refusals after validation", () => {
  it("publish: a live version that moved is 409 draftConflict; nothing changes", async () => {
    const a = await withDraft();
    const hash = a.t.deps.config.current().configHash;
    refuse.next = loadError("", "config.liveChanged");
    const r = await a.call("admin", "POST", `${API}/publish`, { draftVersion: 2 });
    expect(r.status).toBe(409);
    expect((await errorOf(r)).code).toBe("draftConflict");
    expect(a.t.deps.config.current().configHash).toBe(hash);
    expect(await a.t.auditRows("configPublished")).toEqual([]);
    expect((await a.versionRows()).map((v) => v.status)).toEqual(["published", "draft"]);
  });

  it("publish: a draft saved in place after validation is 409; the edit stays a draft", async () => {
    const a = await withDraft();
    const hash = a.t.deps.config.current().configHash;
    const edited = withSiteConfig(await a.exportVersion(1), (s) => {
      s.defaults = { state: "OK", agency: "OTHERPD" };
    });
    refuse.before = async () => {
      const r = await a.call("admin", "PUT", `${API}/draft`, { baseVersion: 1, document: edited });
      expect(r.status).toBe(200);
    };
    const r = await a.call("admin", "POST", `${API}/publish`, { draftVersion: 2 });
    expect(r.status).toBe(409);
    expect((await errorOf(r)).code).toBe("draftConflict");
    expect(a.t.deps.config.current().configHash).toBe(hash);
    expect(await a.t.auditRows("configPublished")).toEqual([]);
    expect((await a.versionRows()).map((v) => [v.version, v.status])).toEqual([
      [1, "published"],
      [2, "draft"],
    ]);
  });

  it.each([
    ["config.liveChanged", "", 409, undefined],
    [
      "config.mfaNotEnforced",
      "/siteConfig/auth/mfaRequired",
      400,
      // C-m2: siteConfig-relative, as validate and the prepare refusal answer it.
      { key: "config.mfaNotEnforced", params: { path: "/auth/mfaRequired" } },
    ],
    [
      "mock sources need ALLOW_MOCK_SOURCES=true",
      "/sources/0/kind",
      400,
      { key: "config.schema", params: { path: "/sources/0/kind" } },
    ],
  ] as const)("rollback refused with %s removes its new row", async (reason, path, status, err) => {
    const a = await withDraft();
    refuse.next = loadError(path, reason);
    const r = await a.call("implementer", "POST", `${API}/versions/1/rollback`);
    expect(r.status).toBe(status);
    const e = await errorOf(r);
    if (err) expect(e.errors).toEqual([err]);
    expect((await a.versionRows()).map((v) => [v.version, v.status])).toEqual([
      [1, "published"],
      [2, "draft"],
    ]);
    expect(await a.t.auditRows("configPublished")).toEqual([]);
  });

  it.each([
    [
      "publish",
      (a: Awaited<ReturnType<typeof withDraft>>) =>
        a.call("admin", "POST", `${API}/publish`, { draftVersion: 2 }),
    ],
    [
      "rollback",
      (a: Awaited<ReturnType<typeof withDraft>>) =>
        a.call("admin", "POST", `${API}/versions/1/rollback`),
    ],
  ] as const)(
    "C-m1: %s that committed answers 200 even if a read after commit fails",
    async (_n, send) => {
      const a = await withDraft();
      const db = a.t.deps.db;
      const select = db.select;
      let failed = false;
      refuse.after = () => {
        db.select = ((...args: Parameters<typeof select>) => {
          if (!failed) {
            failed = true;
            throw new Error("read failed");
          }
          return select.apply(db, args);
        }) as typeof select;
      };
      let r: Response;
      try {
        r = await send(a);
      } finally {
        db.select = select;
      }
      expect(r.status).toBe(200);
      const body = (await r.json()) as { status: string; configHash: string; version: number };
      expect(body.status).toBe("published");
      expect(body.configHash).toBe(a.t.deps.config.current().configHash);
      const row = (await a.versionRows()).find((v) => v.version === body.version);
      expect(row).toMatchObject({ status: "published", configHash: body.configHash });
      expect(await a.t.auditRows("configPublished")).toHaveLength(1);
    },
  );

  it("rollback: any other failure is 500 internal and removes its new row", async () => {
    const a = await withDraft();
    refuse.next = new Error("database unavailable");
    const r = await a.call("admin", "POST", `${API}/versions/1/rollback`);
    expect(r.status).toBe(500);
    expect((await errorOf(r)).code).toBe("internal");
    expect((await a.versionRows()).map((v) => v.version)).toEqual([1, 2]);
  });
});
