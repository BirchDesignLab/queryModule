import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AuditEvent,
  AuditExportLineSchema,
  type AuditReadRow,
  MAX_AUDIT_WINDOW_MS,
} from "@querymodule/core/contracts";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  AUDIT_EXPORT_BATCH,
  AUDIT_EXPORT_MAX_ROWS,
  countAuditExport,
  readAuditExportBatch,
} from "../../src/audit/read";
import type { Db } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { withTransaction } from "../../src/db/tx";
import { uuidv7 } from "../../src/ids";
import { type AdminConfigApp, adminConfigApp, errorOf } from "../helpers/admin-config";
import { openTempDatabase } from "../helpers/db";

// The route reads the row cap from audit/read through a live binding. The cap test lowers it here
// so it inserts a few rows, not 100_000 (heavy on Windows, #755 T4 Q3); every other test runs with
// the real value, and the real value is pinned below.
const capState = vi.hoisted(() => ({ cap: undefined as number | undefined }));
vi.mock("../../src/audit/read", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/audit/read")>();
  return {
    ...real,
    get AUDIT_EXPORT_MAX_ROWS() {
      return capState.cap ?? real.AUDIT_EXPORT_MAX_ROWS;
    },
  };
});

/*
 * GET /api/v1/admin/audit/export (spec 5.1, 4.7; SEC-010, SEC-012; #712, #561 NDJSON box): the
 * page's filters as NDJSON, oldest first by id, bounded by the highest id at the start; one
 * auditExported (filters, rowCount, format) commits before the first byte; over the row cap 400.
 * The guard cases run beside the page's in test/security/admin-audit.test.ts. Mock ids only.
 */

const PATH = "/api/v1/admin/audit/export";
const OFFICER = "zz-export-officer";
const TRAINEE = "zz-export-trainee";
const DAY_MS = 86_400_000;

async function record(a: AdminConfigApp, e: AuditEvent): Promise<number> {
  return (await withTransaction(a.t.deps.db, (tx) => a.t.deps.audit.record(tx, e))).id;
}

/** `n` logout rows by `actor` at `at`, in one statement (no per-row round trip). */
async function bulk(db: Db, n: number, actor: string, at: number): Promise<void> {
  await db.$client.execute({
    sql: `WITH RECURSIVE k(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM k WHERE i < ?)
      INSERT INTO audit_event (type, at, actor_user_id, actor_role, identity_source, details)
      SELECT 'logout', ?, ?, 'user', 'local', '{"sessionId":"0199a0b0-0000-7000-8000-0000000000e1"}' FROM k`,
    args: [n, at, actor],
  });
}

/** Watches every statement the client runs; a returned error fails that statement instead. */
function onStatement(db: Db, see: (sql: string) => Error | undefined): void {
  const client = db.$client;
  const execute = client.execute.bind(client) as (...a: unknown[]) => Promise<unknown>;
  vi.spyOn(client, "execute").mockImplementation(((stmt: unknown, ...rest: unknown[]) => {
    const fail = see(typeof stmt === "string" ? stmt : (stmt as { sql: string }).sql);
    return fail ? Promise.reject(fail) : execute(stmt, ...rest);
  }) as typeof client.execute);
}

const lines = (text: string): AuditReadRow[] =>
  text
    .split("\n")
    .filter((l, i, all) => l !== "" || i !== all.length - 1)
    .map((l) => AuditExportLineSchema.parse(JSON.parse(l)));

/** Three rows: an officer logout, a trainee dispatch on the officer's credentials, a logout. */
async function seeded() {
  const a = await adminConfigApp();
  // The admin signs in first; the window opens after its sign-in rows, so it holds only these.
  await a.userId("admin");
  a.t.clock.advance(60_000);
  const now = a.t.clock.now();
  const window = { from: now - 1_000, to: now + 60_000 };
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
  const traineeLogout = await record(a, logout(TRAINEE, "user"));
  const get = (q: Record<string, string | number>) =>
    a.call(
      "admin",
      "GET",
      `${PATH}?${new URLSearchParams(Object.entries(q).map(([k, v]): [string, string] => [k, String(v)]))}`,
    );
  const exported = () => a.t.auditRows("auditExported");
  return { a, now, window, correlationId, officerLogout, dispatched, traineeLogout, get, exported };
}

describe("spec 5.1 GET /api/v1/admin/audit/export stream", () => {
  it("streams one parsing line per row, oldest first, and writes one auditExported", async () => {
    const s = await seeded();
    const r = await s.get(s.window);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text.endsWith("\n")).toBe(true);
    const rows = lines(text);
    expect(rows.map((x) => x.id)).toEqual([s.officerLogout, s.dispatched, s.traineeLogout]);
    expect(rows[1]).toMatchObject({
      type: "sourceDispatched",
      correlationId: s.correlationId,
      partId: 0,
      actor: { id: TRAINEE, email: null, role: "user" },
      credentialUserId: OFFICER,
      identitySource: "local",
    });
    const exported = await s.exported();
    expect(exported).toHaveLength(1);
    expect(exported[0]?.details).toEqual({
      filters: s.window,
      format: "ndjson",
      rowCount: rows.length,
    });
    expect(exported[0]?.actorUserId).toBe(await s.a.userId("admin"));
    // The export's own row is newer than the bound, so it is not in its stream.
    expect(rows.map((x) => x.id)).not.toContain(exported[0]?.id);
  });

  it("applies and audits every filter", async () => {
    const s = await seeded();
    const q = { ...s.window, user: OFFICER, correlationId: s.correlationId, type: "logout" };
    expect(lines(await (await s.get(q)).text())).toEqual([]);
    const byUser = lines(await (await s.get({ ...s.window, user: OFFICER })).text());
    expect(byUser.map((x) => x.id)).toEqual([s.officerLogout, s.dispatched]);
    const byType = lines(await (await s.get({ ...s.window, type: "sourceDispatched" })).text());
    expect(byType.map((x) => x.id)).toEqual([s.dispatched]);
    expect((await s.exported()).map((x) => x.details)).toEqual([
      {
        filters: { userId: OFFICER, correlationId: s.correlationId, type: "logout", ...s.window },
        format: "ndjson",
        rowCount: 0,
      },
      { filters: { userId: OFFICER, ...s.window }, format: "ndjson", rowCount: 2 },
      { filters: { type: "sourceDispatched", ...s.window }, format: "ndjson", rowCount: 1 },
    ]);
  });

  it("answers NDJSON as an attachment named by the window, no-store", async () => {
    const s = await seeded();
    const r = await s.get(s.window);
    expect(r.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(r.headers.get("content-disposition")).toBe(
      `attachment; filename="audit-${s.window.from}-${s.window.to}.ndjson"`,
    );
    expect(r.headers.get("cache-control")).toBe("no-store");
    await r.text();
  });

  it("rows written after the export starts are absent, across batches", async () => {
    const s = await seeded();
    await bulk(s.a.t.deps.db, AUDIT_EXPORT_BATCH + 100, TRAINEE, s.now);
    const before = AUDIT_EXPORT_BATCH + 100 + 3;
    const r = await s.get(s.window);
    expect(r.status).toBe(200);
    // Written after the bound was taken and the first batch was read, before the rest streams.
    await bulk(s.a.t.deps.db, 7, TRAINEE, s.now);
    const rows = lines(await r.text());
    expect(rows).toHaveLength(before);
    const ids = rows.map((x) => x.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(new Set(ids).size).toBe(ids.length);
    const [exported] = await s.exported();
    expect(exported?.details.rowCount).toBe(before);
    expect(Math.max(...ids)).toBeLessThan(exported?.id ?? 0);
  });

  it("a 31-day window passes; 32 days answers 400", async () => {
    const s = await seeded();
    const to = s.window.to;
    const ok = await s.get({ from: to - 31 * DAY_MS, to });
    expect(ok.status).toBe(200);
    const okLines = lines(await ok.text());
    expect((await s.exported()).map((x) => x.details.rowCount)).toEqual([okLines.length]);
    const over = await s.get({ from: to - 32 * DAY_MS, to });
    expect(over.status).toBe(400);
    expect((await errorOf(over)).code).toBe("validationFailed");
    expect(await s.exported()).toHaveLength(1);
  });
});

describe("spec 5.1 GET /api/v1/admin/audit/export refusals", () => {
  it("the shipped row cap is 100_000 and a batch is 500", () => {
    expect(AUDIT_EXPORT_MAX_ROWS).toBe(100_000);
    expect(AUDIT_EXPORT_BATCH).toBe(500);
  });

  it("over the cap answers 400 exportTooLarge and writes nothing; at the cap it streams", async () => {
    capState.cap = 50;
    onTestFinished(() => {
      capState.cap = undefined;
    });
    const cap = AUDIT_EXPORT_MAX_ROWS;
    const s = await seeded();
    // The bulk rows plus the trainee's dispatch and logout: the trainee filter is the cap.
    await bulk(s.a.t.deps.db, cap - 2, TRAINEE, s.now);
    const over = await s.get(s.window);
    expect(over.status).toBe(400);
    expect(over.headers.get("cache-control")).toBe("no-store");
    const e = await errorOf(over);
    expect(e.code).toBe("validationFailed");
    expect(e.errors).toEqual([{ key: "audit.exportTooLarge" }]);
    expect(await s.exported()).toEqual([]);
    const at = await s.get({ ...s.window, user: TRAINEE });
    expect(at.status).toBe(200);
    expect(lines(await at.text())).toHaveLength(cap);
    expect((await s.exported()).map((x) => x.details.rowCount)).toEqual([cap]);
  });

  it("malformed filters answer 400 naming the parameter only and write no auditExported", async () => {
    const s = await seeded();
    const { from, to } = s.window;
    const bad: Record<string, string | number>[] = [
      { from, to: from + MAX_AUDIT_WINDOW_MS + 1 },
      { from: to, to: from },
      { from: "", to },
      { from, to: "" },
      // Only plain digits: whitespace, hex and exponent forms coerce to numbers (AW2 critic W1).
      // Each pair alone would pass the window rule once coerced.
      { from: " ", to: " " },
      { from: "0x10", to: "0x20" },
      { from: "1e3", to: "2e3" },
      { from: " 1000", to: "2000" },
      { to },
      { from, to, type: "zzNotAType" },
      { from, to, user: "zz bad user" },
      { from, to, correlationId: "zz-not-a-uuid" },
      // The page's paging parameters are not export parameters.
      { from, to, limit: 10 },
      { from, to, cursor: "AAAA" },
    ];
    for (const q of bad) {
      const r = await s.get(q);
      const label = JSON.stringify(q);
      expect(r.status, label).toBe(400);
      const text = await r.text();
      expect(JSON.parse(text).error.code, label).toBe("validationFailed");
      for (const v of ["zzNotAType", "zz bad user", "zz-not-a-uuid"])
        expect(text.includes(v), `${label} echoes ${v}`).toBe(false);
    }
    const typed = await s.get({ from, to, type: "zzNotAType" });
    expect((await errorOf(typed)).errors).toEqual([
      { key: "validation.invalidBody", params: { field: "type" } },
    ]);
    const empty = await s.get({ from: "", to });
    expect((await errorOf(empty)).errors).toEqual([
      { key: "validation.invalidBody", params: { field: "from" } },
    ]);
    expect(await s.exported()).toEqual([]);
  });

  it("an audit write that fails answers 500 internal and streams nothing (fail closed)", async () => {
    const s = await seeded();
    const real = s.a.t.deps.audit.record.bind(s.a.t.deps.audit);
    vi.spyOn(s.a.t.deps.audit, "record").mockImplementation((tx, e) =>
      e.type === "auditExported" ? Promise.reject(new Error("audit down")) : real(tx, e),
    );
    const r = await s.get(s.window);
    expect(r.status).toBe(500);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(r.headers.get("content-disposition")).toBeNull();
    const body = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["error"]);
    expect((body.error as { code: string }).code).toBe("internal");
    expect(await s.exported()).toEqual([]);
    const failed = s.a.t.logLines.filter((l) => l.includes("admin audit export failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("audit");
    expect(failed[0]).not.toContain("audit down");
  });

  it("a refused row in the first batch answers 500 and logs its id only", async () => {
    const s = await seeded();
    const inserted = await s.a.t.deps.db.$client.execute({
      sql: "INSERT INTO audit_event (type, at, actor_user_id, actor_role, identity_source, details) VALUES ('logout', ?, 'zz bad actor', 'user', 'local', '{}') RETURNING id",
      args: [s.now],
    });
    const rowId = Number(inserted.rows[0]?.id);
    const r = await s.get(s.window);
    expect(r.status).toBe(500);
    expect(Object.keys((await r.json()) as object)).toEqual(["error"]);
    const failed = s.a.t.logLines.filter((l) => l.includes("admin audit export failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("AuditRowReadError");
    expect(failed[0]).toContain(String(rowId));
    expect(failed[0]).not.toContain("zz bad actor");
  });

  it("a read error after the first byte ends the stream and logs the class and the last id", async () => {
    const s = await seeded();
    await bulk(s.a.t.deps.db, AUDIT_EXPORT_BATCH, TRAINEE, s.now);
    await s.a.t.deps.db.$client.execute({
      sql: "INSERT INTO audit_event (type, at, actor_user_id, actor_role, identity_source, details) VALUES ('logout', ?, 'zz bad actor', 'user', 'local', '{}')",
      args: [s.now],
    });
    const r = await s.get(s.window);
    expect(r.status).toBe(200);
    const reader = (r.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    const firstLines = lines(new TextDecoder().decode(first.value));
    expect(firstLines).toHaveLength(AUDIT_EXPORT_BATCH);
    await expect(reader.read()).rejects.toThrow();
    const lastId = firstLines.at(-1)?.id;
    const failed = s.a.t.logLines.filter((l) => l.includes("admin audit export failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("stream");
    expect(failed[0]).toContain("AuditRowReadError");
    expect(failed[0]).toContain(`"lastId":${lastId}`);
    expect(failed[0]).not.toContain("zz bad actor");
    // The audit row records the count offered.
    expect((await s.exported()).map((x) => x.details.rowCount)).toEqual([AUDIT_EXPORT_BATCH + 4]);
  });

  it("a count read that fails answers 500, writes nothing and logs the class only", async () => {
    const s = await seeded();
    onStatement(s.a.t.deps.db, (sql) =>
      sql.includes("coalesce((SELECT max(") ? new Error("zz-count-down") : undefined,
    );
    const r = await s.get(s.window);
    expect(r.status).toBe(500);
    expect((await errorOf(r)).code).toBe("internal");
    vi.restoreAllMocks();
    expect(await s.exported()).toEqual([]);
    const failed = s.a.t.logLines.filter((l) => l.includes("admin audit export failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("count");
    expect(failed[0]).not.toContain("zz-count-down");
  });

  it("a client abort stops the batches", async () => {
    const s = await seeded();
    await bulk(s.a.t.deps.db, AUDIT_EXPORT_BATCH * 4, TRAINEE, s.now);
    let batches = 0;
    onStatement(s.a.t.deps.db, (sql) => {
      if (/order by "audit_event"."id" asc/i.test(sql)) batches += 1;
      return undefined;
    });
    const r = await s.get(s.window);
    const reader = (r.body as ReadableStream<Uint8Array>).getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await new Promise((done) => setTimeout(done, 50));
    // The first batch, and at most the one pull the first read started; never the rest.
    expect(batches).toBeGreaterThanOrEqual(1);
    expect(batches).toBeLessThanOrEqual(2);
    expect(s.a.t.logLines.some((l) => l.includes("admin audit export failed"))).toBe(false);
  });

  it("no log line carries a filter value", async () => {
    const s = await seeded();
    await (await s.get({ ...s.window, user: OFFICER, correlationId: s.correlationId })).text();
    await (await s.get({ ...s.window, type: "sourceDispatched" })).text();
    await s.get({ ...s.window, user: "zz bad user" });
    const logs = s.a.t.logLines.join("\n");
    expect(logs).toContain(PATH);
    for (const v of [OFFICER, s.correlationId, "zz bad user", "sourceDispatched"])
      expect(logs.includes(v), v).toBe(false);
  });
});

describe("spec 5.1 audit export reader", () => {
  const T0 = 1_790_000_000_000;
  async function fresh(): Promise<Db> {
    const db = await openTempDatabase();
    await runMigrations(db, resolve(import.meta.dirname, "../../drizzle"));
    return db;
  }

  it("takes the highest id over every row and the filtered count in one read", async () => {
    const db = await fresh();
    expect(await countAuditExport(db, { from: T0, to: T0 + 10 })).toEqual({ maxId: 0, count: 0 });
    await bulk(db, 3, "zz-u1", T0);
    await bulk(db, 2, "zz-u2", T0 + 100);
    expect(await countAuditExport(db, { from: T0, to: T0 + 10 })).toEqual({ maxId: 5, count: 3 });
    expect(await countAuditExport(db, { from: T0, to: T0 + 100, user: "zz-u2" })).toEqual({
      maxId: 5,
      count: 2,
    });
  });

  it("reads oldest first by id, strictly after the last id and never past maxId", async () => {
    const db = await fresh();
    await bulk(db, 6, "zz-u1", T0);
    const f = { from: T0, to: T0 };
    const ids = async (after: number, maxId: number, limit: number) =>
      (await readAuditExportBatch(db, f, { afterId: after, maxId, limit })).map((x) => x.id);
    expect(await ids(0, 6, 4)).toEqual([1, 2, 3, 4]);
    expect(await ids(4, 6, 4)).toEqual([5, 6]);
    expect(await ids(2, 4, 10)).toEqual([3, 4]);
    expect(await ids(6, 6, 4)).toEqual([]);
  });
});

describe("NFR-001 the export refusal key has an en string (AW2 review T4)", () => {
  it("audit.exportTooLarge is in packages/config/locales/en.json", () => {
    const en = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../config/locales/en.json"), "utf8"),
    ) as Record<string, string>;
    expect(en["audit.exportTooLarge"]).toMatch(/\S/);
  });
});
