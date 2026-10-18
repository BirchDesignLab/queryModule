import { resolve } from "node:path";
import {
  AdminAuditPageSchema,
  type AuditEvent,
  CreateUserResponseSchema,
  MAX_AUDIT_WINDOW_MS,
} from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { withTransaction } from "../../src/db/tx";
import { uuidv7 } from "../../src/ids";
import { type AdminConfigApp, adminConfigApp, errorOf } from "../helpers/admin-config";

/*
 * GET /api/v1/admin/audit (spec 5.1, 4.7; SEC-010, SEC-011, SEC-012; #711, #561, #690 m1
 * m3): admin only behind adminAudit; filters by user (actor OR credential owner), correlation id,
 * type and an inclusive window of at most 31 days; cursor paged newest first; every page writes
 * one auditViewed after the read, and an audit failure fails closed (500, no rows). Mock ids only.
 */

const FLAGS_OFF = resolve(import.meta.dirname, "../../../config/test/flags-off.json");
const PATH = "/api/v1/admin/audit";
const OFFICER = "zz-audit-officer";
const TRAINEE = "zz-audit-trainee";

async function record(a: AdminConfigApp, e: AuditEvent): Promise<number> {
  return (await withTransaction(a.t.deps.db, (tx) => a.t.deps.audit.record(tx, e))).id;
}

/** Five rows: an officer logout, a trainee dispatch on the officer's credentials, three logouts. */
async function seeded(o: { siteConfig?: string } = {}) {
  const a = await adminConfigApp(o);
  const now = a.t.clock.now();
  const window = { from: now - 60_000, to: now + 60_000 };
  const correlationId = uuidv7(now);
  const logout = (id: string, role: "user" | "trainingOfficer"): AuditEvent => ({
    type: "logout",
    actor: { id, email: null, role },
    identitySource: "local",
    details: { sessionId: uuidv7(now) },
  });
  const officerLogout = await record(a, logout(OFFICER, "trainingOfficer"));
  const dispatched = await record(a, {
    type: "sourceDispatched",
    correlationId,
    partId: 0,
    actor: { id: TRAINEE, email: null, role: "user" },
    credentialUserId: OFFICER,
    identitySource: "local",
    details: {
      partId: 0,
      sourceId: "mock",
      resultId: uuidv7(now),
      credentialOwnerUserId: OFFICER,
      delegationId: null,
      adapterKind: "mock",
    },
  });
  const traineeLogouts = [
    await record(a, logout(TRAINEE, "user")),
    await record(a, logout(TRAINEE, "user")),
    await record(a, logout(TRAINEE, "user")),
  ];
  const get = (q: Record<string, string | number>, who: Parameters<typeof a.call>[0] = "admin") =>
    a.call(
      who,
      "GET",
      `${PATH}?${new URLSearchParams(Object.entries(q).map(([k, v]): [string, string] => [k, String(v)]))}`,
    );
  const page = async (q: Record<string, string | number>) => {
    const r = await get(q);
    expect(r.status).toBe(200);
    return AdminAuditPageSchema.parse(await r.json());
  };
  const viewed = () => a.t.auditRows("auditViewed");
  return { a, window, correlationId, officerLogout, dispatched, traineeLogouts, get, page, viewed };
}

describe("spec 5.1 GET /api/v1/admin/audit filters", () => {
  it("user matches actor rows and credential-owner rows; type and correlationId are exact", async () => {
    const s = await seeded();
    const ids = async (q: Record<string, string>) =>
      (await s.page({ ...s.window, ...q })).events.map((e) => e.id);
    expect(await ids({ user: OFFICER })).toEqual([s.dispatched, s.officerLogout]);
    expect(await ids({ user: TRAINEE, type: "logout" })).toEqual([...s.traineeLogouts].reverse());
    expect(await ids({ correlationId: s.correlationId })).toEqual([s.dispatched]);
    expect(await ids({ type: "sourceDispatched", user: OFFICER })).toEqual([s.dispatched]);
    const one = (await s.page({ ...s.window, correlationId: s.correlationId })).events[0];
    expect(one).toMatchObject({
      type: "sourceDispatched",
      correlationId: s.correlationId,
      partId: 0,
      actor: { id: TRAINEE, role: "user" },
      credentialUserId: OFFICER,
      identitySource: "local",
    });
  });

  it("the window is inclusive at both ends", async () => {
    const s = await seeded();
    const [newest] = (await s.page({ ...s.window, user: OFFICER })).events;
    if (!newest) throw new Error("no row");
    const at = newest.at;
    expect((await s.page({ from: at, to: at, user: OFFICER })).events.map((e) => e.id)).toContain(
      newest.id,
    );
    expect((await s.page({ from: at + 1, to: at + 2, user: OFFICER })).events).toEqual([]);
  });

  it("limit 2 pages through every row exactly once by nextCursor, null at the end", async () => {
    const s = await seeded();
    const seen: number[] = [];
    const cursors: (string | undefined)[] = [];
    let cursor: string | null = null;
    do {
      cursors.push(cursor ?? undefined);
      const p = await s.page({
        ...s.window,
        user: TRAINEE,
        limit: 2,
        ...(cursor === null ? {} : { cursor }),
      });
      expect(p.events.length).toBeLessThanOrEqual(2);
      seen.push(...p.events.map((e) => e.id));
      cursor = p.nextCursor;
    } while (cursor !== null && cursors.length < 10);
    expect(seen).toEqual([s.dispatched, ...s.traineeLogouts].reverse());
    // Each page wrote one auditViewed with the filters, the cursor it was sent and its row count.
    const viewed = await s.viewed();
    expect(viewed).toHaveLength(2);
    expect(viewed.map((v) => v.details)).toEqual([
      { filters: { userId: TRAINEE, ...s.window }, rowCount: 2 },
      { filters: { userId: TRAINEE, ...s.window }, cursor: cursors[1], rowCount: 2 },
    ]);
    expect(viewed.every((v) => v.actorUserId !== "system")).toBe(true);
    expect(viewed[0]?.actorUserId).toBe(await s.a.userId("admin"));
  });

  it("auditViewed records every filter it was given", async () => {
    const s = await seeded();
    await s.page({ ...s.window, user: OFFICER, correlationId: s.correlationId, type: "logout" });
    expect((await s.viewed()).map((v) => v.details)).toEqual([
      {
        filters: {
          userId: OFFICER,
          correlationId: s.correlationId,
          type: "logout",
          ...s.window,
        },
        rowCount: 0,
      },
    ]);
  });

  it("a page never contains its own auditViewed row", async () => {
    const s = await seeded();
    expect((await s.page({ ...s.window, type: "auditViewed" })).events).toEqual([]);
    const [first] = await s.viewed();
    const second = await s.page({ ...s.window, type: "auditViewed" });
    expect(second.events.map((e) => e.id)).toEqual([first?.id]);
    expect(await s.viewed()).toHaveLength(2);
  });
});

describe("spec 5.1 GET /api/v1/admin/audit refusals (#561 Q2, #690 m1 m3)", () => {
  it("malformed filters answer 400 validationFailed, echo no value, and write no auditViewed", async () => {
    const s = await seeded();
    const { from, to } = s.window;
    const bad: Record<string, string | number>[] = [
      { from, to: from + MAX_AUDIT_WINDOW_MS + 1 },
      { from: to, to: from },
      { from: "", to },
      { from, to: "" },
      { to },
      { from },
      { from, to, limit: "" },
      { from, to, limit: 0 },
      { from, to, limit: 201 },
      { from, to, type: "zzNotAType" },
      { from, to, user: "zz bad user" },
      { from, to, correlationId: "zz-not-a-uuid" },
      { from, to, cursor: "" },
      { from, to, cursor: "zz+cursor/" },
      // The audited alphabet, but not a cursor this route issued.
      { from, to, cursor: "AAAA" },
      { from, to, zzUnknown: "zz-unknown-value" },
    ];
    for (const q of bad) {
      const r = await s.get(q);
      const label = JSON.stringify(q);
      expect(r.status, label).toBe(400);
      expect(r.headers.get("cache-control"), label).toBe("no-store");
      const text = await r.text();
      expect(JSON.parse(text).error.code, label).toBe("validationFailed");
      for (const v of ["zzNotAType", "zz bad user", "zz-not-a-uuid", "zz+cursor/", "zz-unknown"])
        expect(text.includes(v), `${label} echoes ${v}`).toBe(false);
    }
    expect(await s.viewed()).toEqual([]);
  });

  it("names the failing parameter, never its value", async () => {
    const s = await seeded();
    const r = await s.get({ ...s.window, type: "zzNotAType" });
    expect((await errorOf(r)).errors).toEqual([
      { key: "validation.invalidBody", params: { field: "type" } },
    ]);
    // One error per parameter, naming it; an unknown parameter is not named.
    const half = await s.get({ ...s.window, limit: "0.5" });
    expect((await errorOf(half)).errors).toEqual([
      { key: "validation.invalidBody", params: { field: "limit" } },
    ]);
    const unknown = await s.get({ ...s.window, zzUnknown: "1" });
    expect((await errorOf(unknown)).errors).toEqual([{ key: "validation.invalidBody" }]);
    const empty = await s.get({ from: "", to: s.window.to });
    expect((await errorOf(empty)).errors).toEqual([
      { key: "validation.invalidBody", params: { field: "from" } },
    ]);
    const c = await s.get({ ...s.window, cursor: "AAAA" });
    expect((await errorOf(c)).errors).toEqual([
      { key: "validation.invalidBody", params: { field: "cursor" } },
    ]);
  });

  it("an audit write that fails answers 500 internal with no rows (fail closed)", async () => {
    const s = await seeded();
    const record = s.a.t.deps.audit.record.bind(s.a.t.deps.audit);
    vi.spyOn(s.a.t.deps.audit, "record").mockImplementation((tx, e) =>
      e.type === "auditViewed" ? Promise.reject(new Error("audit down")) : record(tx, e),
    );
    const r = await s.get({ ...s.window, user: OFFICER });
    expect(r.status).toBe(500);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["error"]);
    expect((body.error as { code: string }).code).toBe("internal");
    expect(await s.viewed()).toEqual([]);
    const failed = s.a.t.logLines.filter((l) => l.includes("admin audit page failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("Error");
    expect(failed[0]).not.toContain("audit down");
  });

  it("a stored row the read schema refuses answers 500 with no rows and logs its id only", async () => {
    const s = await seeded();
    const at = s.a.t.clock.now();
    const inserted = await s.a.t.deps.db.$client.execute({
      sql: "INSERT INTO audit_event (type, at, actor_user_id, actor_role, identity_source, details) VALUES ('logout', ?, 'zz bad actor', 'user', 'local', '{}') RETURNING id",
      args: [at],
    });
    const rowId = Number(inserted.rows[0]?.id);
    const r = await s.get(s.window);
    expect(r.status).toBe(500);
    expect(Object.keys((await r.json()) as object)).toEqual(["error"]);
    expect(await s.viewed()).toEqual([]);
    const failed = s.a.t.logLines.filter((l) => l.includes("admin audit page failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("AuditRowReadError");
    expect(failed[0]).toContain(String(rowId));
    expect(failed[0]).not.toContain("zz bad actor");
  });

  it("a stored row whose details are not JSON answers 500 and logs the error class only", async () => {
    const s = await seeded();
    await s.a.t.deps.db.$client.execute({
      sql: "INSERT INTO audit_event (type, at, actor_user_id, actor_role, identity_source, details) VALUES ('logout', ?, 'zz-u9', 'user', 'local', 'zz-not-json')",
      args: [s.a.t.clock.now()],
    });
    const r = await s.get(s.window);
    expect(r.status).toBe(500);
    expect(await s.viewed()).toEqual([]);
    const failed = s.a.t.logLines.filter((l) => l.includes("admin audit page failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("SyntaxError");
    expect(failed[0]).not.toContain("zz-not-json");
    expect(failed[0]).not.toContain("rowId");
  });

  it("a host admin's auditViewed carries identitySource host and its hostSubject", async () => {
    const s = await seeded();
    await s.a.userId("admin");
    const resolve = s.a.t.deps.identity.resolveGated.bind(s.a.t.deps.identity);
    vi.spyOn(s.a.t.deps.identity, "resolveGated").mockImplementation(async (req) => {
      const g = await resolve(req);
      return (
        g && {
          ...g,
          principal: { ...g.principal, identitySource: "host", hostSubject: "zz-host-subject-01" },
        }
      );
    });
    await s.page({ ...s.window, type: "auditViewed" });
    const rows = await s.a.t.deps.db.$client.execute(
      "SELECT identity_source, host_subject FROM audit_event WHERE type = 'auditViewed'",
    );
    expect(rows.rows.map((x) => [x.identity_source, x.host_subject])).toEqual([
      ["host", "zz-host-subject-01"],
    ]);
  });

  it("no log line carries a filter value or a cursor", async () => {
    const s = await seeded();
    const first = await s.page({ ...s.window, user: OFFICER, limit: 1 });
    if (!first.nextCursor) throw new Error("expected a second page");
    await s.page({ ...s.window, user: OFFICER, limit: 1, cursor: first.nextCursor });
    await s.page({ ...s.window, correlationId: s.correlationId, type: "sourceDispatched" });
    await s.get({ ...s.window, user: "zz bad user" });
    const logs = s.a.t.logLines.join("\n");
    expect(logs).toContain("/api/v1/admin/audit");
    for (const v of [OFFICER, s.correlationId, first.nextCursor, "zz bad user", "sourceDispatched"])
      expect(logs.includes(v), v).toBe(false);
  });
});

describe("ADR-0011 item 6 GET /api/v1/admin/audit access", () => {
  it("implementer, trainingOfficer and user 403 forbidden; anonymous 401; no auditViewed", async () => {
    const s = await seeded();
    const want = {
      implementer: [403, "forbidden"],
      trainingOfficer: [403, "forbidden"],
      user: [403, "forbidden"],
      anonymous: [401, "unauthenticated"],
    } as const;
    for (const [who, [status, code]] of Object.entries(want)) {
      const r = await s.get(s.window, who as keyof typeof want);
      expect(r.status, who).toBe(status);
      expect(r.headers.get("cache-control"), who).toBe("no-store");
      expect((await errorOf(r)).code, who).toBe(code);
    }
    expect(await s.viewed()).toEqual([]);
  }, 30_000);

  it("a user who still holds a temporary password gets 403 passwordChangeRequired", async () => {
    const s = await seeded();
    const created = await s.a.call("admin", "POST", "/api/v1/admin/users", {
      email: "fresh-audit@example.test",
      name: "Fresh",
      role: "admin",
    });
    const { temporaryPassword } = CreateUserResponseSchema.parse(await created.json());
    const cookie = await s.a.t.cookieFor("fresh-audit@example.test", temporaryPassword);
    const r = await s.a.t.request(
      `${PATH}?${new URLSearchParams({ from: String(s.window.from), to: String(s.window.to) })}`,
      { headers: { cookie } },
    );
    expect(r.status).toBe(403);
    expect((await errorOf(r)).code).toBe("passwordChangeRequired");
    expect(await s.viewed()).toEqual([]);
  });

  it("adminAudit off: an admin and anonymous get 404 notFound", async () => {
    const s = await seeded({ siteConfig: FLAGS_OFF });
    for (const who of ["admin", "anonymous"] as const) {
      const r = await s.get(s.window, who);
      expect(r.status, who).toBe(404);
      expect((await errorOf(r)).code, who).toBe("notFound");
    }
    expect(await s.viewed()).toEqual([]);
  });

  it("a 200 carries Cache-Control: no-store", async () => {
    const s = await seeded();
    const r = await s.get(s.window);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
