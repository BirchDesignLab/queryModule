import { resolve } from "node:path";
import { ROUTES } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { API, adminConfigApp, type Caller, errorOf } from "../helpers/admin-config";

/*
 * ADR-0011 item 6, checker ruling 09-29-26: the admin config routes are configEditor (admin or
 * implementer) behind the adminConfig feature. user and trainingOfficer get 403 forbidden,
 * anonymous 401, and every caller 404 while the feature is off. implementer is config only: 403
 * on POST /api/v1/queries. SEC-014, BR-001.
 */

const DEFAULT_SITE = resolve(import.meta.dirname, "../../../config/sites/default.json");

/** One request per config route that passes access; `ok` is its status for an allowed caller. */
const CASES = [
  { id: "getAdminConfig", method: "GET", path: API, ok: 200 },
  { id: "putAdminConfigDraft", method: "PUT", path: `${API}/draft`, body: "draft", ok: 200 },
  { id: "validateAdminConfig", method: "POST", path: `${API}/validate`, body: "doc", ok: 200 },
  // An empty body passes access and fails the body schema.
  { id: "publishAdminConfig", method: "POST", path: `${API}/publish`, body: {}, ok: 400 },
  { id: "listAdminConfigVersions", method: "GET", path: `${API}/versions`, ok: 200 },
  {
    id: "rollbackAdminConfig",
    method: "POST",
    path: `${API}/versions/abc/rollback`,
    ok: 400,
  },
  { id: "exportAdminConfigVersion", method: "GET", path: `${API}/versions/1/export`, ok: 200 },
] as const;

describe("SEC-014 ADR-0011 admin config route access", () => {
  it("covers every admin config route in the contract, each marked live", () => {
    const config = ROUTES.filter((r) => r.path.startsWith(API));
    expect(config.map((r) => r.id).sort()).toEqual(CASES.map((c) => c.id).sort());
    for (const r of config) expect(r.status, r.id).toBe("live");
  });

  it("implementer and admin pass; user and trainingOfficer 403; anonymous 401", async () => {
    const a = await adminConfigApp();
    const doc = await a.exportVersion(1);
    const bodyOf = (c: (typeof CASES)[number]): unknown => {
      if (!("body" in c)) return undefined;
      if (c.body === "draft") return { baseVersion: 1, document: doc };
      if (c.body === "doc") return { document: doc };
      return c.body;
    };
    const expected: Record<Caller, number | "ok"> = {
      anonymous: 401,
      user: 403,
      trainingOfficer: 403,
      implementer: "ok",
      admin: "ok",
    };
    for (const c of CASES) {
      for (const [who, want] of Object.entries(expected) as [Caller, number | "ok"][]) {
        const r = await a.call(who, c.method, c.path, bodyOf(c));
        expect(r.status, `${who} ${c.id}`).toBe(want === "ok" ? c.ok : want);
        if (want !== "ok")
          expect((await errorOf(r)).code).toBe(want === 401 ? "unauthenticated" : "forbidden");
      }
    }
  });

  it("every caller gets 404 notFound while adminConfig is off", async () => {
    const a = await adminConfigApp({ siteConfig: DEFAULT_SITE });
    for (const c of CASES) {
      for (const who of ["anonymous", "user", "implementer", "admin"] as const) {
        const r = await a.call(who, c.method, c.path, "body" in c ? {} : undefined);
        expect(r.status, `${who} ${c.id}`).toBe(404);
        expect((await errorOf(r)).code).toBe("notFound");
      }
    }
  });

  it("a write without X-Requested-With is 403 forbidden", async () => {
    const a = await adminConfigApp();
    await a.userId("admin");
    const cookie = await a.t.cookieFor("admin@example.test", "correct-horse-battery-1");
    const r = await a.t.request(`${API}/publish`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ draftVersion: 2 }),
    });
    expect(r.status).toBe(403);
  });
});

describe("SEC-014 implementer is config only (checker ruling 09-29-26)", () => {
  it("implementer reads the app shell config and preferences but gets 403 on POST /api/v1/queries", async () => {
    const a = await adminConfigApp();
    expect((await a.call("implementer", "GET", "/api/v1/config")).status).toBe(200);
    expect((await a.call("implementer", "GET", "/api/v1/me/preferences")).status).toBe(200);
    const configHash = a.t.deps.config.current().configHash;
    const body = {
      queryType: "VEH",
      values: { plate: "ZZ-0001" },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "plateOnly",
      configHash,
    };
    const submit = (who: Caller) =>
      a.call(who, "POST", "/api/v1/queries", body, { "idempotency-key": crypto.randomUUID() });
    const r = await submit("implementer");
    expect(r.status).toBe(403);
    expect((await errorOf(r)).code).toBe("forbidden");
    // The same submit from a user is acknowledged, so the 403 is the role, not the body.
    expect((await submit("user")).status).toBe(202);
    const rows = await a.t.deps.db.$client.execute(
      "SELECT count(*) AS n FROM query_request WHERE user_id = ?",
      [await a.userId("implementer")],
    );
    expect(Number(rows.rows[0]?.n)).toBe(0);
  });
});

describe("ADR-0011 draft and validate body cap", () => {
  it("draft save and validate take a document over 32 KiB; 256 KiB is the cap", async () => {
    const a = await adminConfigApp();
    const doc = await a.exportVersion(1);
    const overlay = (n: number) => ({
      ...doc,
      locales: { en: Object.fromEntries(Array.from({ length: n }, (_, i) => [`x.k${i}`, "ZZ"])) },
    });
    const big = overlay(4000); // about 60 KiB
    expect(JSON.stringify(big).length).toBeGreaterThan(48 * 1024);
    const put = await a.call("admin", "PUT", `${API}/draft`, { baseVersion: 1, document: big });
    expect(put.status).toBe(200);
    expect((await a.call("admin", "POST", `${API}/validate`, { document: big })).status).toBe(200);
    const huge = overlay(20000); // over 256 KiB
    expect(JSON.stringify(huge).length).toBeGreaterThan(256 * 1024);
    const tooBig = await a.call("admin", "PUT", `${API}/draft`, { baseVersion: 1, document: huge });
    expect(tooBig.status).toBe(413);
    expect((await errorOf(tooBig)).code).toBe("payloadTooLarge");
    // Every other route keeps the 32 KiB API cap.
    const prefs = await a.call("admin", "PUT", "/api/v1/me/preferences", JSON.stringify(big));
    expect(prefs.status).toBe(413);
  });
});
