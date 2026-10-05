import type { SiteConfig } from "@querymodule/core/config";
import {
  ApiErrorSchema,
  type AuditEvent,
  SubmitQueryResponseSchema,
} from "@querymodule/core/contracts";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { auditEvent, queryRequest, requestKey, sourceResult } from "../../src/db/schema";
import type { Tx } from "../../src/db/tx";
import { openPartValues, unwrapRequestKey } from "../../src/keys/request-keys";
import { type Acknowledged, acknowledge } from "../../src/queries/acknowledge";
import type { PreparedSubmit } from "../../src/queries/prepare";
import {
  bindJobs,
  lostIdempotencyRace,
  planJobs,
  sanitizeSubmitError,
} from "../../src/queries/route";
import type { Principal } from "../../src/seams";
import { TEST_SECRETS, type TestClock } from "../helpers/fixture";
import { createTestApp, type TestApp } from "../helpers/test-app";

/**
 * AW3 critic (b): a switch that makes prepare hand back a plan whose extra pair names a source the
 * snapshot does not have, so the pre-T1 job planning guard trips. Off by default.
 */
const corruptPrepare = vi.hoisted(() => ({ on: false }));
vi.mock("../../src/queries/prepare", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/queries/prepare")>();
  return {
    ...m,
    prepareSubmit: (...args: Parameters<typeof m.prepareSubmit>) => {
      const r = m.prepareSubmit(...args);
      const first = r.ok ? r.value.pairs[0] : undefined;
      if (corruptPrepare.on && r.ok && first) {
        r.value.pairs.push({ ...first, sourceId: "noSuchSource" });
      }
      return r;
    },
  };
});

const PASSWORD = "correct-horse-battery-1";
const EMAIL = "dispatcher@example.test";
const PLATE = "ZZ-0001";
const LAST = "TESTERSON";

/** A clock that stands still unless advanced, so acknowledgedAt and audit `at` are exact. */
function fixedClock(): TestClock & { t0: number } {
  const t0 = Date.now();
  let offset = 0;
  return {
    t0,
    now: () => t0 + offset,
    advance: (ms) => {
      offset += ms;
    },
  };
}

interface Setup {
  t: TestApp;
  clock: ReturnType<typeof fixedClock>;
  userId: string;
  configHash: string;
  post: (body: Record<string, unknown>, o?: PostOpts) => Promise<Response>;
  body: (over?: Record<string, unknown>) => Record<string, unknown>;
}
interface PostOpts {
  key?: string;
  headers?: Record<string, string>;
  rawBody?: string;
}

/** The assembled app, a signed-in user and the loaded configHash from GET /api/v1/config. */
async function setup(o: { site?: (c: SiteConfig) => void } = {}): Promise<Setup> {
  const clock = fixedClock();
  const t = await createTestApp({ clock });
  if (o.site) {
    const siteConfig = structuredClone(t.deps.config.current().siteConfig);
    o.site(siteConfig);
    t.deps.config.swap({ ...t.deps.config.current(), siteConfig });
  }
  const userId = await t.createUser(EMAIL, PASSWORD);
  const cookie = await t.cookieFor(EMAIL, PASSWORD);
  const cfg = (await (await t.request("/api/v1/config", { headers: { cookie } })).json()) as {
    configHash: string;
  };
  const configHash = cfg.configHash;
  const post = (body: Record<string, unknown>, p: PostOpts = {}) =>
    t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": p.key ?? crypto.randomUUID(),
        ...p.headers,
      },
      body: p.rawBody ?? JSON.stringify(body),
    });
  const body = (over: Record<string, unknown> = {}) => ({
    queryType: "VEH",
    values: { plate: PLATE },
    sourceIds: ["stateSource", "nationalSource"],
    mode: "plateOnly",
    configHash,
    ...over,
  });
  return { t, clock, userId, configHash, post, body };
}

async function rowsFor(t: TestApp, correlationId: string) {
  const db = t.deps.db;
  return {
    keys: await db.select().from(requestKey).where(eq(requestKey.correlationId, correlationId)),
    parts: await db
      .select()
      .from(queryRequest)
      .where(eq(queryRequest.correlationId, correlationId))
      .orderBy(asc(queryRequest.partId)),
    results: await db
      .select()
      .from(sourceResult)
      .where(eq(sourceResult.correlationId, correlationId)),
    audit: await db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.correlationId, correlationId))
      .orderBy(asc(auditEvent.id)),
  };
}

async function tableCounts(t: TestApp) {
  const count = async (table: string) =>
    Number(
      (await t.deps.db.$client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]?.n ?? -1,
    );
  return {
    queryRequest: await count("query_request"),
    sourceResult: await count("source_result"),
    requestKey: await count("request_key"),
    queryAudit: Number(
      (
        await t.deps.db.$client.execute(
          "SELECT COUNT(*) AS n FROM audit_event WHERE correlation_id IS NOT NULL",
        )
      ).rows[0]?.n ?? -1,
    ),
  };
}

/** Opens part `partId`'s sealed values through the request's values DEK. */
function openValues(t: TestApp, rows: Awaited<ReturnType<typeof rowsFor>>, partId: number) {
  const keyRow = rows.keys.find((k) => k.scope === "values");
  const part = rows.parts.find((p) => p.partId === partId);
  if (!keyRow || !part?.valuesCiphertext || !part.valuesIv || !part.valuesTag)
    throw new Error("sealed values missing");
  const dek = unwrapRequestKey(TEST_SECRETS.dataKey, keyRow);
  expect(t.deps.dataKey).toBe(TEST_SECRETS.dataKey);
  return openPartValues(dek, part.correlationId, partId, {
    ciphertext: part.valuesCiphertext,
    iv: part.valuesIv,
    tag: part.valuesTag,
  });
}

async function accepted(r: Response) {
  expect(r.status).toBe(202);
  const text = await r.text();
  return { text, body: SubmitQueryResponseSchema.parse(JSON.parse(text)) };
}

describe("POST /api/v1/queries transaction T1 (spec 5.2 step 4, FR-040, FR-041, SEC-010)", () => {
  it("a plate-only VEH answers 202 with the acknowledged plan at the test clock", async () => {
    const { post, body, clock } = await setup();
    const { body: ack } = await accepted(await post(body()));
    expect(ack.acknowledgedAt).toBe(clock.t0);
    expect(ack.parts).toEqual([
      {
        partId: 0,
        queryType: "VEH",
        status: "dispatched",
        sourceIds: ["stateSource"],
        droppedSourceIds: ["nationalSource"],
      },
    ]);
  });

  it("writes two request keys, one sealed part row and one pending source_result row", async () => {
    const { t, post, body, userId, configHash, clock } = await setup();
    const key = crypto.randomUUID();
    const { body: ack } = await accepted(await post(body(), { key }));
    const rows = await rowsFor(t, ack.correlationId);
    expect(rows.keys.map((k) => k.scope).sort()).toEqual(["payload", "values"]);
    expect(rows.keys.every((k) => k.createdAt === clock.t0 && k.keyVersion === 1)).toBe(true);
    expect(rows.parts).toHaveLength(1);
    const part = rows.parts[0];
    expect(part?.valuesCiphertext?.includes(Buffer.from(PLATE))).toBe(false);
    expect(openValues(t, rows, 0)).toEqual({ plate: PLATE, state: "TX" });
    expect(part).toMatchObject({
      userId,
      parentPartId: null,
      origin: "primary",
      queryType: "VEH",
      typeValues: {},
      plateOnly: 1,
      selectedSourceIds: ["stateSource", "nationalSource"],
      droppedSourceIds: ["nationalSource"],
      skippedReason: null,
      configHash,
      idempotencyKey: key,
      submittedAt: clock.t0,
    });
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      partId: 0,
      sourceId: "stateSource",
      userId,
      status: "pending",
      adapterKind: "mock",
      credentialUserId: null,
      delegationId: null,
      payloadCiphertext: null,
      createdAt: clock.t0,
    });
  });

  it("audits submitted, sourceDispatched, acknowledged with no field value in any row", async () => {
    const { t, post, body, userId, configHash, clock } = await setup();
    const ticks = [100, 107.4];
    t.deps.monotonic = { nowMs: () => ticks.shift() ?? Number.NaN };
    const { body: ack } = await accepted(await post(body()));
    const rows = await rowsFor(t, ack.correlationId);
    expect(rows.audit.map((a) => a.type)).toEqual([
      "submitted",
      "sourceDispatched",
      "acknowledged",
    ]);
    for (const a of rows.audit) {
      expect(a.at).toBe(clock.t0);
      expect(a.actorUserId).toBe(userId);
      expect(a.identitySource).toBe("local");
      expect(a.credentialUserId).toBeNull();
    }
    const [submitted, dispatched, acknowledged] = rows.audit;
    expect(submitted?.partId).toBe(0);
    expect(submitted?.details).toEqual({
      partId: 0,
      parentPartId: null,
      origin: "primary",
      queryType: "VEH",
      typeValues: {},
      selectedSourceIds: ["stateSource", "nationalSource"],
      dispatchedSourceIds: ["stateSource"],
      droppedSourceIds: ["nationalSource"],
      plateOnly: true,
      configHash,
    });
    expect(dispatched?.partId).toBe(0);
    expect(dispatched?.details).toEqual({
      partId: 0,
      sourceId: "stateSource",
      resultId: rows.results[0]?.resultId,
      credentialOwnerUserId: null,
      delegationId: null,
      adapterKind: "mock",
    });
    expect(acknowledged?.partId).toBeNull();
    // received at 100 ms, acknowledged at 107.4 ms on the monotonic stub (spec 4.7)
    expect(acknowledged?.details).toEqual({
      acknowledgedAt: clock.t0,
      ackLatencyMs: 7,
      partCount: 1,
    });
    expect(JSON.stringify(rows)).not.toContain(PLATE);
  });

  it("a PER with the WNT check writes two parts, a submitted per part and a dispatch per pair", async () => {
    const { t, post, body } = await setup();
    const { body: ack } = await accepted(
      await post(body({ queryType: "PER", values: { last: LAST }, mode: "normal" })),
    );
    expect(ack.parts.map((p) => [p.partId, p.queryType, p.status, p.sourceIds])).toEqual([
      [0, "PER", "dispatched", ["stateSource", "nationalSource"]],
      [1, "WNT", "dispatched", ["nationalSource"]],
    ]);
    const rows = await rowsFor(t, ack.correlationId);
    expect(rows.parts.map((p) => [p.partId, p.parentPartId, p.origin, p.plateOnly])).toEqual([
      [0, null, "primary", 0],
      [1, 0, "alsoRun", 0],
    ]);
    expect(rows.parts[1]?.idempotencyKey).toBeNull();
    expect(rows.parts[1]?.selectedSourceIds).toEqual(["nationalSource"]);
    expect(openValues(t, rows, 1)).toEqual({ last: LAST });
    expect(rows.audit.map((a) => [a.type, a.partId])).toEqual([
      ["submitted", 0],
      ["submitted", 1],
      ["sourceDispatched", 0],
      ["sourceDispatched", 0],
      ["sourceDispatched", 1],
      ["acknowledged", null],
    ]);
    expect(rows.audit[1]?.details).toMatchObject({
      origin: "alsoRun",
      parentPartId: 0,
      fieldMapApplied: { last: "last", first: "first", dob: "dob" },
    });
    expect(rows.audit[5]?.details).toMatchObject({ partCount: 2 });
    expect(JSON.stringify(rows.audit)).not.toContain(LAST);
  });

  it("a skipped WNT writes partSkipped, a part row without values and no source_result", async () => {
    // WNT made to require dob, so a PER without dob skips it (spec 4.6 step 5)
    const { t, post, body } = await setup({
      site: (c) => {
        const wnt = c.queryTypes.find((q) => q.code === "WNT");
        const dob = wnt?.fields.find((f) => f.key === "dob");
        if (!dob) throw new Error("WNT dob missing");
        dob.required = true;
      },
    });
    const { body: ack } = await accepted(
      await post(body({ queryType: "PER", values: { last: LAST }, mode: "normal" })),
    );
    expect(ack.parts[1]).toEqual({
      partId: 1,
      queryType: "WNT",
      status: "skipped",
      sourceIds: [],
      droppedSourceIds: [],
    });
    const rows = await rowsFor(t, ack.correlationId);
    expect(rows.parts[1]).toMatchObject({
      valuesCiphertext: null,
      valuesIv: null,
      valuesTag: null,
      skippedReason: [{ key: "validation.required", params: { field: "dob" } }],
    });
    expect(rows.results.map((r) => r.partId)).toEqual([0, 0]);
    expect(rows.audit.map((a) => [a.type, a.partId])).toEqual([
      ["submitted", 0],
      ["submitted", 1],
      ["partSkipped", 1],
      ["sourceDispatched", 0],
      ["sourceDispatched", 0],
      ["acknowledged", null],
    ]);
    expect(rows.audit[2]?.details).toEqual({
      partId: 1,
      parentPartId: 0,
      queryType: "WNT",
      typeValues: {},
      reasons: [{ key: "validation.required", params: { field: "dob" } }],
    });
    expect(rows.audit[1]?.details).toMatchObject({
      selectedSourceIds: [],
      dispatchedSourceIds: [],
      plateOnly: false,
    });
  });

  it("plateOnly is per part: a plate-only nested part under a normal primary (carry #285)", async () => {
    // PER also runs VEH with last as plate: the nested VEH is plate-only, the primary is not
    const { t, post, body } = await setup({
      site: (c) => {
        const per = c.queryTypes.find((q) => q.code === "PER");
        if (!per) throw new Error("PER missing");
        per.alsoRun = [{ queryType: "VEH", fieldMap: { plate: "last" } }];
      },
    });
    const { body: ack } = await accepted(
      await post(body({ queryType: "PER", values: { last: "ZZ" }, mode: "normal" })),
    );
    expect(ack.parts[1]).toEqual({
      partId: 1,
      queryType: "VEH",
      status: "dispatched",
      sourceIds: ["stateSource"],
      droppedSourceIds: ["nationalSource"],
    });
    const rows = await rowsFor(t, ack.correlationId);
    expect(rows.parts.map((p) => [p.partId, p.plateOnly, p.selectedSourceIds])).toEqual([
      [0, 0, ["stateSource", "nationalSource"]],
      [1, 1, ["stateSource", "nationalSource"]],
    ]);
    expect(rows.audit.filter((a) => a.type === "submitted").map((a) => a.details)).toEqual([
      expect.objectContaining({ partId: 0, plateOnly: false, droppedSourceIds: [] }),
      expect.objectContaining({ partId: 1, plateOnly: true, droppedSourceIds: ["nationalSource"] }),
    ]);
  });

  it("persists the plan's canonical queryType and visible values only (carry #284)", async () => {
    const { t, post, body } = await setup();
    const { body: ack } = await accepted(
      await post(
        body({ queryType: "veh", values: { plate: PLATE, plateType: "PC" }, mode: "plateOnly" }),
      ),
    );
    expect(ack.parts[0]?.queryType).toBe("VEH");
    const rows = await rowsFor(t, ack.correlationId);
    expect(rows.parts[0]?.queryType).toBe("VEH");
    // plateType is hidden while state is the default: absent from the sealed values
    expect(openValues(t, rows, 0)).toEqual({ plate: PLATE, state: "TX" });
    expect(rows.audit[0]?.details).toMatchObject({ queryType: "VEH" });
  });
});

describe("POST /api/v1/queries idempotency (spec 5.2 step 1)", () => {
  it("the same key replays the live 202 byte for byte, even with a different body", async () => {
    const { t, post, body } = await setup();
    const key = crypto.randomUUID();
    const live = await accepted(await post(body(), { key }));
    const before = await tableCounts(t);
    const replay = await accepted(await post(body(), { key }));
    expect(replay.text).toBe(live.text);
    const other = await accepted(
      await post(body({ queryType: "PER", values: { last: LAST }, mode: "normal" }), { key }),
    );
    expect(other.text).toBe(live.text);
    expect(await tableCounts(t)).toEqual(before);
  });

  it("a skipped part replays byte for byte", async () => {
    const { post, body } = await setup({
      site: (c) => {
        const dob = c.queryTypes.find((q) => q.code === "WNT")?.fields.find((f) => f.key === "dob");
        if (!dob) throw new Error("WNT dob missing");
        dob.required = true;
      },
    });
    const key = crypto.randomUUID();
    const per = body({ queryType: "PER", values: { last: LAST }, mode: "normal" });
    const live = await accepted(await post(per, { key }));
    expect((await accepted(await post(per, { key }))).text).toBe(live.text);
  });

  it("two concurrent posts with one key both get the same 202 and one set of rows", async () => {
    const { t, post, body } = await setup();
    // Both requests pass the limiter before either reads for a replay, so both miss it and
    // race into T1; the loser hits the idempotency guard and replays the winner.
    const hit = t.deps.limiter.hit.bind(t.deps.limiter);
    let arrived = 0;
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    t.deps.limiter.hit = async (...args) => {
      const r = await hit(...args);
      arrived += 1;
      if (arrived === 2) open();
      await gate;
      return r;
    };
    const failures: unknown[] = [];
    const transaction = t.deps.db.transaction.bind(t.deps.db);
    vi.spyOn(t.deps.db, "transaction").mockImplementation((fn, config) =>
      transaction(fn, config).catch((e: unknown) => {
        failures.push(e);
        throw e;
      }),
    );
    const enqueue = vi.spyOn(t.deps.dispatcher, "enqueue").mockImplementation(() => true);
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([post(body(), { key }), post(body(), { key })]);
    const ra = await accepted(a);
    const rb = await accepted(b);
    expect(rb.text).toBe(ra.text);
    expect(failures).toHaveLength(1);
    expect(String((failures[0] as Error).cause)).toMatch(/query_request idempotency key exists/);
    expect(await tableCounts(t)).toEqual({
      queryRequest: 1,
      sourceResult: 1,
      requestKey: 2,
      queryAudit: 3,
    });
    // the winner enqueues its one row; the loser's replay enqueues nothing
    expect(enqueue.mock.calls.flatMap((c) => c[0]).map((j) => j.correlationId)).toEqual([
      ra.body.correlationId,
    ]);
  });

  it("a race-shaped error with no winner row propagates as 500 internal", async () => {
    const { t, post, body } = await setup();
    const record = t.deps.audit.record.bind(t.deps.audit);
    t.deps.audit.record = async (tx: Tx, e: AuditEvent) => {
      if (e.type === "acknowledged") throw new Error("query_request idempotency key exists");
      return record(tx, e);
    };
    const r = await post(body());
    expect(r.status).toBe(500);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("internal");
  });

  it("a replay with no acknowledged row is 500 internal, logged without row contents", async () => {
    const { t, post, body, userId } = await setup();
    const key = crypto.randomUUID();
    const cid = "01890a5d-ac96-774b-bcce-b302099a8057";
    await t.deps.db.$client.execute({
      sql: `INSERT INTO query_request (correlation_id, part_id, user_id, origin, query_type,
        type_values, plate_only, selected_source_ids, dropped_source_ids, config_hash,
        idempotency_key, submitted_at) VALUES (?, 0, ?, 'primary', 'VEH', '{}', 0, '[]', '[]', 'h1', ?, 1)`,
      args: [cid, userId, key],
    });
    t.logLines.length = 0;
    const r = await post(body(), { key });
    expect(r.status).toBe(500);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("internal");
    const lines = t.logLines.filter((l) => l.includes('"msg":"unhandled"'));
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual(["err", "level", "method", "msg", "path", "time"]);
    expect(line.err).toEqual({
      name: "ReplayIntegrityError",
      message: "replay: acknowledged audit row missing",
    });
    expect([line.method, line.path]).toEqual(["POST", "/api/v1/queries"]);
    for (const s of [cid, key, userId, PLATE, "h1"]) expect(lines[0]).not.toContain(s);
  });
});

describe("POST /api/v1/queries fail closed and middleware (SEC-012, spec 5.9)", () => {
  it("an audit failure on acknowledged is 500 internal and leaves no rows", async () => {
    const { t, post, body } = await setup();
    const record = t.deps.audit.record.bind(t.deps.audit);
    t.deps.audit.record = async (tx: Tx, e: AuditEvent) => {
      if (e.type === "acknowledged") throw new Error("audit down");
      return record(tx, e);
    };
    const before = await tableCounts(t);
    const r = await post(body());
    expect(r.status).toBe(500);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("internal");
    expect(await tableCounts(t)).toEqual(before);
    expect(before).toEqual({ queryRequest: 0, sourceResult: 0, requestKey: 0, queryAudit: 0 });
    expect(t.logLines.join("\n")).not.toContain(PLATE);
  });

  it.each(["request_key", "query_request", "source_result"])(
    "a real driver failure on the %s insert logs a fixed message, no params or key bytes",
    async (table) => {
      const { t, post, body, userId, configHash } = await setup();
      // A real LibsqlError, wrapped by drizzle in a DrizzleQueryError that quotes every param.
      await t.deps.db.$client.execute(
        `CREATE TRIGGER probe_abort BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'probe abort'); END`,
      );
      const key = crypto.randomUUID();
      t.logLines.length = 0;
      const r = await post(body(), { key });
      expect(r.status).toBe(500);
      expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("internal");
      const lines = t.logLines.filter((l) => l.includes('"msg":"unhandled"'));
      expect(lines).toHaveLength(1);
      const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(line.err).toEqual({
        name: "SubmitTransactionError",
        message: "submit transaction failed (SQLITE_CONSTRAINT)",
      });
      for (const s of ["params", "Failed query", "probe abort", key, userId, configHash, PLATE])
        expect(t.logLines.join("\n")).not.toContain(s);
      expect(await tableCounts(t)).toEqual({
        queryRequest: 0,
        sourceResult: 0,
        requestKey: 0,
        queryAudit: 0,
      });
    },
  );

  it.each(["admission", "race"])(
    "a DB failure in the %s replay logs a fixed message, no userId or Idempotency-Key (#317 C-m1)",
    async (where) => {
      const { t, post, body, userId } = await setup();
      const key = crypto.randomUUID();
      // drizzle's wrapper quotes the params: here the userId and the Idempotency-Key.
      const leak = Object.assign(new Error(`Failed query: select ... params: ${userId},${key},0`), {
        name: "DrizzleQueryError",
        cause: Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" }),
      });
      const select = t.deps.db.select.bind(t.deps.db);
      // Only replay reads query_request on the app connection: admission replays first, and the
      // race path replays again after T1 loses. The session lookup's selects pass through.
      let replays = 0;
      vi.spyOn(t.deps.db, "select").mockImplementation(((...a: Parameters<typeof select>) => {
        const builder = select(...a);
        const from = builder.from.bind(builder);
        builder.from = ((table: Parameters<typeof from>[0]) => {
          if (table === queryRequest) {
            replays += 1;
            if (where === "admission" || replays > 1) throw leak;
          }
          return from(table);
        }) as typeof from;
        return builder;
      }) as typeof select);
      if (where === "race") {
        const record = t.deps.audit.record.bind(t.deps.audit);
        t.deps.audit.record = async (tx: Tx, e: AuditEvent) => {
          if (e.type === "acknowledged") throw new Error("query_request idempotency key exists");
          return record(tx, e);
        };
      }
      t.logLines.length = 0;
      const r = await post(body(), { key });
      expect(r.status).toBe(500);
      expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("internal");
      const lines = t.logLines.filter((l) => l.includes('"msg":"unhandled"'));
      expect(lines).toHaveLength(1);
      const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(line.err).toEqual({
        name: "SubmitTransactionError",
        message: "submit replay failed (SQLITE_BUSY)",
      });
      for (const s of ["params", "Failed query", key, userId])
        expect(t.logLines.join("\n")).not.toContain(s);
    },
  );

  it("a 33 KB body is 413 and a missing X-Requested-With is 403, both before admission", async () => {
    const { t, post, body } = await setup();
    const hit = vi.spyOn(t.deps.limiter, "hit");
    const big = await post(body(), {
      rawBody: JSON.stringify({ ...body(), pad: "x".repeat(33 * 1024) }),
    });
    expect(big.status).toBe(413);
    expect(ApiErrorSchema.parse(await big.json()).error.code).toBe("payloadTooLarge");
    const noHeader = await post(body(), { headers: { "x-requested-with": "" } });
    expect(noHeader.status).toBe(403);
    expect(ApiErrorSchema.parse(await noHeader.json()).error.code).toBe("forbidden");
    expect(hit).not.toHaveBeenCalled();
    expect((await tableCounts(t)).queryRequest).toBe(0);
  });

  it("a rejected, a stale-hash and an unauthenticated post write nothing", async () => {
    const { t, post, body } = await setup();
    const bad = await post(body({ mode: "normal" }));
    expect(bad.status).toBe(400);
    const stale = await post(body({ configHash: "0".repeat(64) }));
    expect(stale.status).toBe(409);
    const noKey = await post(body(), { headers: { "idempotency-key": "" } });
    expect(noKey.status).toBe(400);
    const anon = await t.request("/api/v1/queries", {
      method: "POST",
      headers: { "x-requested-with": "querymodule", "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    expect(anon.status).toBe(401);
    expect(await tableCounts(t)).toEqual({
      queryRequest: 0,
      sourceResult: 0,
      requestKey: 0,
      queryAudit: 0,
    });
  });
});

describe("POST /api/v1/queries hands off to the dispatcher (spec 5.2 step 5, FR-040, FR-041)", () => {
  it("a 202 enqueues one job per source_result row with its resultId, the pinned snapshot and deadline", async () => {
    const { t, post, body, userId } = await setup();
    const enqueue = vi.spyOn(t.deps.dispatcher, "enqueue").mockImplementation(() => true);
    const pinned = t.deps.config.current();
    // A publish lands while T1 runs: the jobs keep the snapshot prepare planned against.
    const record = t.deps.audit.record.bind(t.deps.audit);
    t.deps.audit.record = async (tx: Tx, e: AuditEvent) => {
      if (e.type === "acknowledged") t.deps.config.swap({ ...pinned });
      return record(tx, e);
    };
    const { body: ack } = await accepted(
      await post(body({ queryType: "PER", values: { last: LAST }, mode: "normal" })),
    );
    expect(t.deps.config.current()).not.toBe(pinned);
    const rows = await rowsFor(t, ack.correlationId);
    expect(rows.results.length).toBeGreaterThan(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const jobs = enqueue.mock.calls[0]?.[0] ?? [];
    expect(jobs.map((j) => j.resultId).sort()).toEqual(rows.results.map((r) => r.resultId).sort());
    const sources = new Map(pinned.siteConfig.sources.map((s) => [s.id, s]));
    for (const row of rows.results) {
      const j = jobs.find((x) => x.resultId === row.resultId);
      const part = rows.parts.find((x) => x.partId === row.partId);
      expect(j).toEqual({
        correlationId: ack.correlationId,
        partId: row.partId,
        sourceId: row.sourceId,
        resultId: row.resultId,
        userId,
        actor: { id: userId, email: EMAIL, role: "user" },
        identitySource: "local",
        queryType: part?.queryType,
        types: part?.typeValues,
        values: openValues(t, rows, row.partId),
        snapshot: pinned,
        adapterKind: "mock",
        credentialUserId: null,
        delegationId: null,
        requiresCredentials: sources.get(row.sourceId)?.requiresCredentials,
        deadline: ack.acknowledgedAt + 10_000,
        acknowledgedMonoMs: expect.any(Number),
      });
      expect(j?.snapshot).toBe(pinned);
    }
  });

  it("a replayed Idempotency-Key enqueues nothing", async () => {
    const { t, post, body } = await setup();
    const enqueue = vi.spyOn(t.deps.dispatcher, "enqueue").mockImplementation(() => true);
    const key = crypto.randomUUID();
    await accepted(await post(body(), { key }));
    expect(enqueue).toHaveBeenCalledTimes(1);
    await accepted(await post(body(), { key }));
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  function plannedVeh(config: PreparedSubmit["config"], configHash: string): PreparedSubmit {
    return {
      config,
      request: {
        queryType: "VEH",
        values: { plate: PLATE },
        sourceIds: ["stateSource"],
        mode: "normal",
        configHash,
      },
      plan: {
        mode: "normal",
        droppedSourceIds: [],
        parts: [
          {
            partId: 0,
            parentPartId: null,
            origin: "primary",
            queryType: "VEH",
            typeValues: {},
            values: { plate: PLATE },
            sourceIds: ["stateSource"],
            droppedSourceIds: [],
            mode: "normal",
            status: "planned",
          },
        ],
      },
      pairs: [
        {
          partId: 0,
          sourceId: "stateSource",
          adapterKind: "mock",
          credentialUserId: null,
          delegationId: null,
        },
      ],
    };
  }
  const principalOf = (userId: string): Principal => ({
    userId,
    email: null,
    role: "user",
    sessionId: "session-1",
    identitySource: "local",
    authenticatedAt: 1,
  });

  it("planJobs refuses a pair with no plan part or source config, before T1 (bug guards)", async () => {
    const { t, userId, configHash } = await setup();
    const prepared = plannedVeh(t.deps.config.current(), configHash);
    const principal = principalOf(userId);
    expect(() =>
      planJobs({ ...prepared, plan: { ...prepared.plan, parts: [] } }, principal),
    ).toThrow("dispatch: pair has no plan part");
    const pair = prepared.pairs[0];
    if (!pair) throw new Error("no pair");
    expect(() =>
      planJobs({ ...prepared, pairs: [{ ...pair, sourceId: "noSuchSource" }] }, principal),
    ).toThrow("dispatch: pair has no source config");
    const [local] = planJobs(prepared, principal);
    expect(local).not.toHaveProperty("hostSubject");
    const [host] = planJobs(prepared, {
      ...principal,
      identitySource: "host",
      hostSubject: "host-subject-1",
    });
    expect(host).toMatchObject({ identitySource: "host", hostSubject: "host-subject-1" });
  });

  it("bindJobs zips T1's results onto the planned jobs; a replay binds nothing", async () => {
    const { t, userId, configHash } = await setup();
    const config = t.deps.config.current();
    const timeoutMs = config.siteConfig.sources.find((x) => x.id === "stateSource")?.timeoutMs;
    const templates = planJobs(plannedVeh(config, configHash), principalOf(userId));
    const ack: Acknowledged = {
      body: { correlationId: "corr-1", acknowledgedAt: 1_000, parts: [] },
      acknowledgedAt: 1_000,
      results: [{ partId: 0, sourceId: "stateSource", resultId: "result-1" }],
    };
    expect(bindJobs(templates, ack, 0)).toEqual([
      expect.objectContaining({
        correlationId: "corr-1",
        resultId: "result-1",
        sourceId: "stateSource",
        deadline: 1_000 + (timeoutMs ?? Number.NaN),
      }),
    ]);
    expect(bindJobs(templates, { ...ack, results: [] }, 0)).toEqual([]);
    // a result that does not line up with its pair is a bug: the route's backstop catches it
    expect(() =>
      bindJobs(
        templates,
        {
          ...ack,
          results: [{ partId: 0, sourceId: "nationalSource", resultId: "r" }],
        },
        0,
      ),
    ).toThrow("dispatch: result does not match its pair");
  });

  it("AW3 critic (b): a planning guard trips before T1: 500, nothing committed, nothing enqueued", async () => {
    const { t, post, body, userId } = await setup();
    const enqueue = vi.spyOn(t.deps.dispatcher, "enqueue").mockImplementation(() => true);
    corruptPrepare.on = true;
    try {
      const r = await post(body());
      expect(r.status).toBe(500);
      expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("internal");
    } finally {
      corruptPrepare.on = false;
    }
    expect(enqueue).not.toHaveBeenCalled();
    const requests = await t.deps.db
      .select()
      .from(queryRequest)
      .where(eq(queryRequest.userId, userId));
    expect(requests).toEqual([]);
    const results = await t.deps.db
      .select()
      .from(sourceResult)
      .where(eq(sourceResult.userId, userId));
    expect(results).toEqual([]);
    const audit = await t.deps.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.actorUserId, userId));
    // only the sign-in row: no submitted, dispatched or acknowledged row
    expect(audit.filter((a) => a.correlationId !== null)).toEqual([]);
    expect(t.fatals).toEqual([]);
  });

  it("AW3 review C-C-m1: a 202 body that fails its schema rolls T1 back: 500, nothing committed", async () => {
    const { t, post, body, userId } = await setup();
    const enqueue = vi.spyOn(t.deps.dispatcher, "enqueue").mockImplementation(() => true);
    vi.spyOn(SubmitQueryResponseSchema, "parse").mockImplementationOnce(() => {
      throw new Error("response schema mismatch");
    });
    const r = await post(body());
    expect(r.status).toBe(500);
    expect(enqueue).not.toHaveBeenCalled();
    const requests = await t.deps.db
      .select()
      .from(queryRequest)
      .where(eq(queryRequest.userId, userId));
    expect(requests).toEqual([]);
    const results = await t.deps.db
      .select()
      .from(sourceResult)
      .where(eq(sourceResult.userId, userId));
    expect(results).toEqual([]);
    expect(t.fatals).toEqual([]);
  });

  it("AW3 critic (b) backstop: a throw after T1 commits logs ids and class only and fails closed", async () => {
    const { t, post, body } = await setup();
    vi.spyOn(t.deps.dispatcher, "enqueue").mockImplementation(() => {
      throw new TypeError("enqueue broke");
    });
    const { body: ack } = await accepted(await post(body()));
    const rows = await rowsFor(t, ack.correlationId);
    expect(rows.results.length).toBeGreaterThan(0);
    expect(rows.results.filter((r) => r.status !== "pending")).toEqual([]);
    expect(t.fatals).toHaveLength(1);
    const line = t.logLines.find((l) => l.includes("dispatch jobs failed"));
    expect(JSON.parse(line ?? "{}")).toMatchObject({
      correlationId: ack.correlationId,
      error: { name: "TypeError" },
    });
    const all = t.logLines.join("\n");
    expect(all).not.toContain("enqueue broke");
    expect(all).not.toContain(PLATE);
  });
});

describe("acknowledge envelope and the race detector (SEC-011, spec 5.2 step 1)", () => {
  it("a pair's credential owner and a host principal's subject reach the audit envelope", async () => {
    const { t, userId, configHash } = await setup();
    const principal: Principal = {
      userId,
      email: EMAIL,
      role: "user",
      sessionId: "session-0001",
      identitySource: "host",
      hostSubject: "host-subject-0001",
      authenticatedAt: 1_790_000_000_000,
    };
    const prepared: PreparedSubmit = {
      config: t.deps.config.current(),
      request: {
        queryType: "VEH",
        values: { plate: PLATE },
        sourceIds: ["stateSource"],
        mode: "normal",
        configHash,
      },
      plan: {
        mode: "normal",
        droppedSourceIds: [],
        parts: [
          {
            partId: 0,
            parentPartId: null,
            origin: "primary",
            queryType: "VEH",
            typeValues: {},
            values: { plate: PLATE },
            sourceIds: ["stateSource"],
            droppedSourceIds: [],
            mode: "normal",
            status: "planned",
          },
        ],
      },
      pairs: [
        {
          partId: 0,
          sourceId: "stateSource",
          credentialUserId: userId,
          delegationId: null,
          adapterKind: "mock",
        },
      ],
    };
    const ack = await acknowledge(t.deps, principal, prepared, {
      idempotencyKey: crypto.randomUUID(),
      receivedAt: 1,
      receivedMono: t.deps.monotonic.nowMs(),
    });
    const rows = await rowsFor(t, ack.body.correlationId);
    expect(ack.acknowledgedAt).toBe(ack.body.acknowledgedAt);
    expect(ack.results).toEqual([
      { partId: 0, sourceId: "stateSource", resultId: rows.results[0]?.resultId },
    ]);
    expect(rows.audit.map((a) => [a.type, a.credentialUserId, a.hostSubject])).toEqual([
      ["submitted", null, "host-subject-0001"],
      ["sourceDispatched", userId, "host-subject-0001"],
      ["acknowledged", null, "host-subject-0001"],
    ]);
    expect(rows.audit[1]?.details).toMatchObject({ credentialOwnerUserId: userId });
    expect(rows.results[0]?.credentialUserId).toBe(userId);
  });

  it("matches only the driver's idempotency guard errors", () => {
    const driver = (message: string) => {
      const inner = Object.assign(new Error(message), { code: "SQLITE_CONSTRAINT" });
      inner.name = "LibsqlError";
      const outer = new Error("Failed query: insert ... params: x", { cause: inner });
      outer.name = "DrizzleQueryError";
      return outer;
    };
    expect(
      lostIdempotencyRace(driver("SQLITE_CONSTRAINT: query_request idempotency key exists")),
    ).toBe(true);
    expect(
      lostIdempotencyRace(
        driver(
          "SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: query_request.user_id, query_request.idempotency_key",
        ),
      ),
    ).toBe(true);
    expect(lostIdempotencyRace(driver("SQLITE_CONSTRAINT: query_request is insert-once"))).toBe(
      false,
    );
    expect(lostIdempotencyRace(driver("UNIQUE constraint failed: source_result.result_id"))).toBe(
      false,
    );
    // the wrapper's own message quotes params, so a match there alone does not count
    const quoted = new Error("Failed query: params: query_request idempotency key exists");
    quoted.name = "DrizzleQueryError";
    expect(lostIdempotencyRace(quoted)).toBe(false);
    expect(lostIdempotencyRace("query_request idempotency key exists")).toBe(false);
  });

  it("sanitizeSubmitError keeps only a driver result code, never a message or cause", () => {
    const inner = Object.assign(new Error("SQLITE_BUSY: params ZZ-0001"), { code: "SQLITE_BUSY" });
    const outer = new Error("Failed query: params: ZZ-0001", { cause: inner });
    const e = sanitizeSubmitError(outer);
    expect([e.name, e.message, e.cause]).toEqual([
      "SubmitTransactionError",
      "submit transaction failed (SQLITE_BUSY)",
      undefined,
    ]);
    const odd = Object.assign(new Error("x"), { code: "ZZ-0001 leaked" });
    expect(sanitizeSubmitError(odd).message).toBe("submit transaction failed");
    expect(sanitizeSubmitError("audit down").message).toBe("submit transaction failed");
  });
});
