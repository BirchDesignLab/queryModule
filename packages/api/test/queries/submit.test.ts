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
import { acknowledge } from "../../src/queries/acknowledge";
import type { PreparedSubmit } from "../../src/queries/prepare";
import { lostIdempotencyRace } from "../../src/queries/route";
import type { Principal } from "../../src/seams";
import { TEST_SECRETS, type TestClock } from "../helpers/fixture";
import { createTestApp, type TestApp } from "../helpers/test-app";

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
    const siteConfig = structuredClone(t.deps.config.siteConfig);
    o.site(siteConfig);
    t.deps.config = { ...t.deps.config, siteConfig };
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
        body({ queryType: "veh", values: { plate: PLATE, plateType: "PC" }, mode: "normal" }),
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
    expect(line.err).toEqual({ name: "Error", message: "replay: acknowledged audit row missing" });
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
    const rows = await rowsFor(t, ack.correlationId);
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
});
