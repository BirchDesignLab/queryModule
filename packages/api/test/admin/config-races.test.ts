import { describe, expect, it, vi } from "vitest";
import { ConfigLoadError } from "../../src/config/load";
import { API, adminConfigApp, errorOf, withSiteConfig } from "../helpers/admin-config";

/*
 * ADR-0011 items 3 and 5, SEC-010: activate() can still refuse after publish or rollback has
 * validated (a save, publish or rollback committed in between). The refusal maps to an API
 * answer, leaves the old snapshot live and writes no audit row; a rollback removes the version
 * row it inserted (still a draft, never history).
 */

const refuse = vi.hoisted(() => ({ next: undefined as Error | undefined }));
vi.mock("../../src/admin/config/activate", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/admin/config/activate")>();
  return {
    activate: (...args: Parameters<typeof m.activate>) => {
      const e = refuse.next;
      refuse.next = undefined;
      return e ? Promise.reject(e) : m.activate(...args);
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

describe("SEC-010 ADR-0011 activate refusals after validation", () => {
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

  it.each([
    ["config.liveChanged", "", 409, undefined],
    [
      "config.mfaNotEnforced",
      "/siteConfig/auth/mfaRequired",
      400,
      { key: "config.mfaNotEnforced", params: { path: "/siteConfig/auth/mfaRequired" } },
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

  it("rollback: any other failure is 500 internal and removes its new row", async () => {
    const a = await withDraft();
    refuse.next = new Error("database unavailable");
    const r = await a.call("admin", "POST", `${API}/versions/1/rollback`);
    expect(r.status).toBe(500);
    expect((await errorOf(r)).code).toBe("internal");
    expect((await a.versionRows()).map((v) => v.version)).toEqual([1, 2]);
  });
});
