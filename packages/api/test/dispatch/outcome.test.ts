import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type MockFile,
  MockFileSchema,
  SubmitQueryResponseSchema,
  type WsEvent,
} from "@querymodule/core/contracts";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { auditEvent, eventLog, requestKey, sourceResult } from "../../src/db/schema";
import { buildDeps } from "../../src/deps";
import type { DispatchJob, Outcome } from "../../src/dispatch/dispatcher";
import { OutcomeWriteError, recordOutcome } from "../../src/dispatch/outcome";
import { open } from "../../src/keys/aead";
import { payloadAad, unwrapRequestKey } from "../../src/keys/request-keys";
import { QUERY_LIMIT } from "../../src/queries/admission";
import { closeWhenTestFinishes, TEST_SECRETS, testEnv } from "../helpers/fixture";
import { manualTime } from "../helpers/manual-time";
import { createTestApp, type TestApp } from "../helpers/test-app";

// Spec 5.2 step 6, 4.7 (FR-043, SEC-010, SEC-011, SEC-012): each outcome is written once in its
// own transaction T2 with a sourceResponded audit row and an event_log row, then published to the
// owner as sourceStatus in seq order. A failed T2 leaves the row pending and fails closed.
// Time is manual: the mock adapter's latency and the deadlines fire only when the test runs them.
const PASSWORD = "correct-horse-battery-1";
const EMAIL = "outcome@example.test";
const PLATE = "ZZ-0001";
const MOCK: MockFile = MockFileSchema.parse(
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/mock/default.json"), "utf8"),
  ),
);

/** The mock's VEH answer for `plate` from `sourceId` (the scenario's respond, else the default). */
function mockAnswer(sourceId: string, plate: string): unknown {
  const veh = MOCK.sources[sourceId]?.responses.find((r) => r.queryType === "VEH");
  const s = veh?.scenarios.find((x) => x.when.plate === plate);
  return s?.respond ?? veh?.default;
}

async function setup(o: { onFatal?: (e: unknown) => void } = {}) {
  const time = manualTime();
  // random 0: the mock's minimum latency, stateSource 50 ms and nationalSource 100 ms
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
    ...(o.onFatal ? { onFatal: o.onFatal } : {}),
  });
  const userId = await t.createUser(EMAIL, PASSWORD);
  const cookie = await t.cookieFor(EMAIL, PASSWORD);
  const { configHash } = t.deps.config.current();
  const published: WsEvent[] = [];
  t.deps.eventBus.subscribe(userId, (e) => published.push(e));
  const jobs: DispatchJob[] = [];
  const enqueue = t.deps.dispatcher.enqueue.bind(t.deps.dispatcher);
  const enqueueSpy = vi.spyOn(t.deps.dispatcher, "enqueue").mockImplementation((js) => {
    jobs.push(...js);
    enqueue(js);
  });
  async function submit(plate: string, sourceIds = ["stateSource", "nationalSource"]) {
    const r = await t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        queryType: "VEH",
        values: { plate, state: "TX" },
        sourceIds,
        mode: "normal",
        configHash,
      }),
    });
    expect(r.status).toBe(202);
    return SubmitQueryResponseSchema.parse(await r.json());
  }
  /** Until every job's outcome write has resolved (real I/O, so polled, never slept). */
  const idle = () => vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
  return { t, time, userId, published, jobs, enqueueSpy, submit, idle };
}

async function resultsFor(t: TestApp, correlationId: string) {
  return t.deps.db
    .select()
    .from(sourceResult)
    .where(eq(sourceResult.correlationId, correlationId))
    .orderBy(asc(sourceResult.receivedAt), asc(sourceResult.sourceId));
}

async function auditFor(t: TestApp, correlationId: string) {
  return t.deps.db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.correlationId, correlationId))
    .orderBy(asc(auditEvent.id));
}

async function eventsFor(t: TestApp, userId: string) {
  return t.deps.db
    .select()
    .from(eventLog)
    .where(eq(eventLog.userId, userId))
    .orderBy(asc(eventLog.seq));
}

async function payloadDek(t: TestApp, correlationId: string): Promise<Buffer> {
  const [row] = await t.deps.db
    .select()
    .from(requestKey)
    .where(and(eq(requestKey.correlationId, correlationId), eq(requestKey.scope, "payload")));
  if (!row) throw new Error("no payload request key");
  return unwrapRequestKey(TEST_SECRETS.dataKey, row);
}

function expectCleanLogs(t: TestApp, dek: Buffer): void {
  const all = t.logLines.join("\n");
  expect(all).not.toContain(PLATE);
  expect(all).not.toContain("STOLEN");
  expect(all).not.toContain(dek.toString("hex"));
  expect(all).not.toContain(dek.toString("base64"));
}

describe("recordOutcome: transaction T2 (spec 5.2 step 6, FR-043, SEC-010, SEC-012)", () => {
  it("VEH ZZ-0001 on both sources: two returned rows, sealed payloads, audit, event_log, sourceStatus", async () => {
    const { t, time, userId, published, submit, idle } = await setup();
    const ack = await submit(PLATE);
    await time.run(100);
    await idle();

    const rows = await resultsFor(t, ack.correlationId);
    expect(rows.map((r) => [r.sourceId, r.status])).toEqual([
      ["stateSource", "returned"],
      ["nationalSource", "returned"],
    ]);
    const dek = await payloadDek(t, ack.correlationId);
    for (const [r, latency] of [
      [rows[0], 50],
      [rows[1], 100],
    ] as const) {
      if (!r?.payloadCiphertext || !r.payloadIv || !r.payloadTag) throw new Error("no payload");
      expect(r.payloadCiphertext.includes(Buffer.from("STOLEN"))).toBe(false);
      const pt = open(
        dek,
        { ciphertext: r.payloadCiphertext, iv: r.payloadIv, tag: r.payloadTag },
        payloadAad(r.resultId),
      );
      expect(JSON.parse(pt.toString("utf8"))).toEqual(mockAnswer(r.sourceId, PLATE));
      expect(r).toMatchObject({
        errorCode: null,
        receivedAt: ack.acknowledgedAt + latency,
        timedOutAt: null,
      });
    }

    const audit = await auditFor(t, ack.correlationId);
    const afterAck = audit.slice(audit.findIndex((a) => a.type === "acknowledged") + 1);
    expect(afterAck.map((a) => a.type)).toEqual(["sourceResponded", "sourceResponded"]);
    for (const a of afterAck) {
      expect(a).toMatchObject({
        partId: 0,
        actorUserId: "system",
        actorEmail: null,
        actorRole: "system",
        identitySource: "system",
        credentialUserId: null,
      });
    }
    expect(afterAck.map((a) => a.details)).toEqual([
      {
        partId: 0,
        sourceId: "stateSource",
        resultId: rows[0]?.resultId,
        status: "returned",
        latencyMs: 50,
        credentialOwnerUserId: null,
        delegationId: null,
        adapterKind: "mock",
      },
      {
        partId: 0,
        sourceId: "nationalSource",
        resultId: rows[1]?.resultId,
        status: "returned",
        latencyMs: 100,
        credentialOwnerUserId: null,
        delegationId: null,
        adapterKind: "mock",
      },
    ]);

    const events = await eventsFor(t, userId);
    expect(events.map((e) => [e.seq, e.resultId, e.status])).toEqual([
      [1, rows[0]?.resultId, "returned"],
      [2, rows[1]?.resultId, "returned"],
    ]);
    expect(published).toEqual(
      rows.map((r, i) => ({
        v: 1,
        type: "sourceStatus",
        seq: i + 1,
        at: r.receivedAt,
        correlationId: ack.correlationId,
        partId: 0,
        sourceId: r.sourceId,
        resultId: r.resultId,
        status: r.status,
      })),
    );
    expectCleanLogs(t, dek);
  });

  it("FAIL1: the state row is failed with error_code failed and no payload", async () => {
    const { t, time, submit, idle } = await setup();
    const ack = await submit("FAIL1");
    await time.run(100);
    await idle();
    const rows = await resultsFor(t, ack.correlationId);
    expect(rows[0]).toMatchObject({
      sourceId: "stateSource",
      status: "failed",
      errorCode: "failed",
      payloadCiphertext: null,
      payloadIv: null,
      payloadTag: null,
      receivedAt: ack.acknowledgedAt + 50,
      timedOutAt: null,
    });
    expect(rows[1]).toMatchObject({ sourceId: "nationalSource", status: "returned" });
    const audit = await auditFor(t, ack.correlationId);
    expect(audit.find((a) => a.type === "sourceResponded")?.details).toEqual({
      partId: 0,
      sourceId: "stateSource",
      resultId: rows[0]?.resultId,
      status: "failed",
      latencyMs: 50,
      credentialOwnerUserId: null,
      delegationId: null,
      adapterKind: "mock",
      errorCode: "failed",
    });
  });

  it("TIMEOUT: state returned, national timedOut at the deadline with timed_out_at", async () => {
    const { t, time, submit, idle } = await setup();
    const ack = await submit("TIMEOUT");
    await time.run(10_000);
    await idle();
    const rows = await resultsFor(t, ack.correlationId);
    const deadline = ack.acknowledgedAt + 10_000;
    expect(rows[0]).toMatchObject({ sourceId: "stateSource", status: "returned" });
    expect(rows[1]).toMatchObject({
      sourceId: "nationalSource",
      status: "timedOut",
      errorCode: null,
      payloadCiphertext: null,
      receivedAt: deadline,
      timedOutAt: deadline,
    });
    const audit = await auditFor(t, ack.correlationId);
    expect(audit.filter((a) => a.type === "sourceResponded").at(-1)?.details).toEqual({
      partId: 0,
      sourceId: "nationalSource",
      resultId: rows[1]?.resultId,
      status: "timedOut",
      latencyMs: 10_000,
      credentialOwnerUserId: null,
      delegationId: null,
      adapterKind: "mock",
    });
  });

  it("a second recordOutcome for the same resultId writes and publishes nothing (write-once)", async () => {
    const { t, time, userId, published, jobs, submit, idle } = await setup();
    const ack = await submit(PLATE);
    await time.run(100);
    await idle();
    const before = {
      rows: await resultsFor(t, ack.correlationId),
      audit: await auditFor(t, ack.correlationId),
      events: await eventsFor(t, userId),
      published: published.length,
    };
    const job = jobs[0];
    if (!job) throw new Error("no job");
    await recordOutcome(t.deps, job, { status: "failed", errorCode: "failed" }, 7);
    expect(await resultsFor(t, ack.correlationId)).toEqual(before.rows);
    expect(await auditFor(t, ack.correlationId)).toEqual(before.audit);
    expect(await eventsFor(t, userId)).toEqual(before.events);
    expect(published).toHaveLength(before.published);
    expect(t.fatals).toEqual([]);
  });

  it("an audit failure on sourceResponded leaves the row pending, publishes nothing and fails closed", async () => {
    const order: string[] = [];
    const { t, time, userId, published, submit, idle } = await setup({
      onFatal: () => order.push("exit"),
    });
    const abortAll = t.deps.dispatcher.abortAll.bind(t.deps.dispatcher);
    vi.spyOn(t.deps.dispatcher, "abortAll").mockImplementation(() => {
      order.push("abortAll");
      abortAll();
    });
    const get = vi.spyOn(t.deps.adapters, "get");
    const record = t.deps.audit.record.bind(t.deps.audit);
    t.deps.audit = {
      record: (tx, e) =>
        e.type === "sourceResponded"
          ? Promise.reject(new Error(`audit down ${PLATE} STOLEN`))
          : record(tx, e),
    };
    const ack = await submit(PLATE, ["stateSource"]);
    expect(get).toHaveBeenCalledTimes(1);
    await time.run(50);
    await idle();
    expect(order).toEqual(["abortAll", "exit"]);
    const rows = await resultsFor(t, ack.correlationId);
    expect(rows.map((r) => [r.status, r.payloadCiphertext, r.receivedAt])).toEqual([
      ["pending", null, null],
    ]);
    expect(await eventsFor(t, userId)).toEqual([]);
    expect(published).toEqual([]);
    const audit = await auditFor(t, ack.correlationId);
    expect(audit.some((a) => a.type === "sourceResponded")).toBe(false);
    const line = t.logLines.find((l) => l.includes("dispatch outcome write failed"));
    expect(JSON.parse(line ?? "{}")).toMatchObject({
      correlationId: ack.correlationId,
      resultId: rows[0]?.resultId,
      sourceId: "stateSource",
      partId: 0,
      error: { name: "Error" },
    });
    // the dispatcher refuses after abortAll: a later submit is acknowledged but calls no adapter
    await submit(PLATE, ["stateSource"]);
    await time.run(10_000);
    expect(get).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["abortAll", "exit"]);
    expectCleanLogs(t, await payloadDek(t, ack.correlationId));
  });

  it("two outcomes of one submit settling in the same tick reach the socket in seq order (50 runs)", async () => {
    const { t, userId, published, jobs, enqueueSpy, submit } = await setup();
    // capture only: no adapter runs, the test settles each pair itself
    enqueueSpy.mockImplementation((js) => {
      jobs.push(...js);
    });
    const outcome: Outcome = { status: "returned", payload: { status: "NO RECORD" } };
    for (let run = 0; run < 50; run += 1) {
      // QUERY_LIMIT is 30 a minute: move past the window halfway through
      if (run === 25) t.clock.advance(QUERY_LIMIT.windowMs);
      jobs.length = 0;
      await submit(PLATE);
      const pair = [...jobs];
      expect(pair).toHaveLength(2);
      if (Math.random() < 0.5) pair.reverse();
      const latencies = [Math.floor(Math.random() * 800), Math.floor(Math.random() * 800)];
      // both writes start in the same tick and contend for the write lock
      await Promise.all(pair.map((j, i) => recordOutcome(t.deps, j, outcome, latencies[i] ?? 0)));
    }
    const seqs = published.map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    const events = await eventsFor(t, userId);
    expect(published.map((e) => (e.type === "sourceStatus" ? e.resultId : null))).toEqual(
      events.map((e) => e.resultId),
    );
    expect(t.fatals).toEqual([]);
  }, 30_000);
});

describe("recordOutcome edges (SEC-011, SEC-012, spec 5.9)", () => {
  async function captured() {
    const s = await setup();
    // capture only: no adapter runs, the test settles each job itself
    s.enqueueSpy.mockImplementation((js) => {
      s.jobs.push(...js);
    });
    const ack = await s.submit(PLATE, ["stateSource"]);
    const job = s.jobs[0];
    if (!job) throw new Error("no job");
    return { ...s, ack, job };
  }
  const returned: Outcome = { status: "returned", payload: { status: "NO RECORD" } };

  it("a credentialed job names the owner in the envelope and in details (SEC-011)", async () => {
    const { t, ack, job } = await captured();
    await recordOutcome(t.deps, { ...job, credentialUserId: "officer-1" }, returned, 12.6);
    const row = (await auditFor(t, ack.correlationId)).find((a) => a.type === "sourceResponded");
    expect(row?.credentialUserId).toBe("officer-1");
    expect(row?.details).toMatchObject({ credentialOwnerUserId: "officer-1", latencyMs: 13 });
    expect(t.fatals).toEqual([]);
  });

  it("a missing payload key fails closed with the row pending and the error class logged", async () => {
    const { t, userId, published, ack, job } = await captured();
    await t.deps.db.delete(requestKey).where(eq(requestKey.correlationId, ack.correlationId));
    await recordOutcome(t.deps, job, returned, 5);
    expect(t.fatals).toHaveLength(1);
    expect(t.fatals[0]).toBeInstanceOf(OutcomeWriteError);
    expect(t.fatals[0]).toMatchObject({
      ids: { correlationId: ack.correlationId, resultId: job.resultId },
      causeName: "PayloadKeyMissingError",
    });
    expect((await resultsFor(t, ack.correlationId))[0]?.status).toBe("pending");
    expect(await eventsFor(t, userId)).toEqual([]);
    expect(published).toEqual([]);
  });

  it("a commit that fails after the event row was taken publishes nothing and fails closed", async () => {
    const { t, userId, published, ack, job } = await captured();
    const transaction = t.deps.db.transaction.bind(t.deps.db);
    vi.spyOn(t.deps.db, "transaction").mockImplementationOnce((fn, config) =>
      transaction(async (tx) => {
        await fn(tx);
        throw new Error("commit failed");
      }, config),
    );
    await recordOutcome(t.deps, job, returned, 5);
    expect(t.fatals).toHaveLength(1);
    expect((await resultsFor(t, ack.correlationId))[0]?.status).toBe("pending");
    expect(await eventsFor(t, userId)).toEqual([]);
    expect(published).toEqual([]);
    // the failed slot does not block the outbox: the next write of the still-pending row publishes
    await recordOutcome(t.deps, job, returned, 5);
    expect(published.map((e) => e.seq)).toEqual([1]);
  });
});

describe("AppDeps.fatal (spec 8.1, SEC-010)", () => {
  it("without onFatal: aborts the dispatcher first, then rethrows outside any promise chain", async () => {
    const deps = await buildDeps({ env: testEnv(), secrets: TEST_SECRETS, logSink: () => {} });
    closeWhenTestFinishes(deps.db, "outcome.test");
    const order: string[] = [];
    vi.spyOn(deps.dispatcher, "abortAll").mockImplementation(() => {
      order.push("abortAll");
    });
    let queued: (() => void) | undefined;
    const q = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((cb) => {
      order.push("queued");
      queued = cb;
    });
    const err = new OutcomeWriteError(
      { correlationId: "c", resultId: "r", sourceId: "s", partId: 0 },
      "Error",
    );
    try {
      deps.fatal(err);
    } finally {
      q.mockRestore();
    }
    expect(order).toEqual(["abortAll", "queued"]);
    expect(() => queued?.()).toThrow(err);
    expect(err.message).toBe("dispatch outcome write failed");
  });
});
