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
    return enqueue(js);
  });
  const post = (plate: string, sourceIds: string[]) =>
    t.request("/api/v1/queries", {
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
  async function submit(plate: string, sourceIds = ["stateSource", "nationalSource"]) {
    const r = await post(plate, sourceIds);
    expect(r.status).toBe(202);
    return SubmitQueryResponseSchema.parse(await r.json());
  }
  /** Until every job's outcome write has resolved (real I/O, so polled, never slept). */
  const idle = () => vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
  return { t, time, userId, published, jobs, enqueueSpy, post, submit, idle };
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
    const acked = audit.find((a) => a.type === "acknowledged");
    const afterAck = audit.slice(audit.findIndex((a) => a.type === "acknowledged") + 1);
    expect(afterAck.map((a) => a.type)).toEqual(["sourceResponded", "sourceResponded"]);
    // AW3 critic (a): the requester's envelope, as on sourceDispatched (spec 4.7, SEC-010)
    for (const a of afterAck) {
      expect(a).toMatchObject({
        partId: 0,
        actorUserId: userId,
        actorEmail: EMAIL,
        actorRole: acked?.actorRole,
        identitySource: "local",
        hostSubject: null,
        credentialUserId: null,
      });
    }
    // the per-user audit search (audit_event_actor_at_idx) finds the whole query
    const byUser = await t.deps.db
      .select({ type: auditEvent.type })
      .from(auditEvent)
      .where(
        and(eq(auditEvent.actorUserId, userId), eq(auditEvent.correlationId, ack.correlationId)),
      )
      .orderBy(asc(auditEvent.id));
    expect(byUser.map((a) => a.type)).toEqual([
      "submitted",
      "sourceDispatched",
      "sourceDispatched",
      "acknowledged",
      "sourceResponded",
      "sourceResponded",
    ]);
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
    const { t, time, userId, published, post, submit, idle } = await setup({
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
    // after the fatal a later submit gets 503 before T1 (AW4 critic 2): no row, no adapter call,
    // no second fail-closed
    const late = await post(PLATE, ["stateSource"]);
    expect(late.status).toBe(503);
    await time.run(10_000);
    expect(get).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["abortAll", "exit"]);
    expectCleanLogs(t, await payloadDek(t, ack.correlationId));
  });

  /**
   * AW3 critic (f): A takes the write lock first and commits seq 1, but its continuation is held
   * until B's whole recordOutcome has returned. A naive publish after the await would send seq 2
   * first; the outbox holds B's slot behind A's, so the socket still sees 1 then 2.
   */
  async function heldFirstCommit(o: { failAfterCommit?: boolean } = {}) {
    const s = await setup();
    s.enqueueSpy.mockImplementation((js) => {
      s.jobs.push(...js);
      return true;
    });
    await s.submit(PLATE);
    const [a, b] = s.jobs;
    if (!a || !b) throw new Error("expected two jobs");
    const transaction = s.t.deps.db.transaction.bind(s.t.deps.db);
    let openGate = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    let calls = 0;
    vi.spyOn(s.t.deps.db, "transaction").mockImplementation((async (
      fn: Parameters<typeof transaction>[0],
      config: Parameters<typeof transaction>[1],
    ) => {
      calls += 1;
      const first = calls === 1;
      const r = await transaction(fn, config);
      if (first) {
        await gate;
        if (o.failAfterCommit) throw new Error("commit failed");
      }
      return r;
    }) as unknown as typeof transaction);
    const outcome: Outcome = { status: "returned", payload: { status: "NO RECORD" } };
    const pa = recordOutcome(s.t.deps, a, outcome, 1);
    await recordOutcome(s.t.deps, b, outcome, 2);
    openGate();
    await pa;
    return { ...s, a, b };
  }

  it("a T2 that commits first publishes first even when its continuation resumes last (outbox)", async () => {
    const { t, userId, published, a, b } = await heldFirstCommit();
    expect(published.map((e) => e.seq)).toEqual([1, 2]);
    expect(published.map((e) => (e.type === "sourceStatus" ? e.resultId : null))).toEqual([
      a.resultId,
      b.resultId,
    ]);
    expect((await eventsFor(t, userId)).map((e) => e.resultId)).toEqual([a.resultId, b.resultId]);
    expect(t.fatals).toEqual([]);
  });

  it("a held first slot whose write then fails is skipped: the later slot still publishes", async () => {
    const { t, published, b } = await heldFirstCommit({ failAfterCommit: true });
    expect(published.map((e) => (e.type === "sourceStatus" ? e.resultId : null))).toEqual([
      b.resultId,
    ]);
    expect(t.fatals).toHaveLength(1);
  });
});

describe("recordOutcome edges (SEC-011, SEC-012, spec 5.9)", () => {
  async function captured() {
    const s = await setup();
    // capture only: no adapter runs, the test settles each job itself
    s.enqueueSpy.mockImplementation((js) => {
      s.jobs.push(...js);
      return true;
    });
    const ack = await s.submit(PLATE, ["stateSource"]);
    const job = s.jobs[0];
    if (!job) throw new Error("no job");
    return { ...s, ack, job };
  }
  const returned: Outcome = { status: "returned", payload: { status: "NO RECORD" } };

  it("a credentialed job names the owner in the envelope and in details (SEC-011)", async () => {
    const { t, userId, ack, job } = await captured();
    await recordOutcome(t.deps, { ...job, credentialUserId: "officer-1" }, returned, 12.6);
    const row = (await auditFor(t, ack.correlationId)).find((a) => a.type === "sourceResponded");
    // the requester (a trainee) is the actor; the credential owner stays in credentialUserId
    expect(row?.actorUserId).toBe(userId);
    expect(row?.credentialUserId).toBe("officer-1");
    expect(row?.details).toMatchObject({ credentialOwnerUserId: "officer-1", latencyMs: 13 });
    expect(t.fatals).toEqual([]);
  });

  it("a host-identity requester keeps identitySource host and the hostSubject (spec 4.7)", async () => {
    const { t, ack, job } = await captured();
    await recordOutcome(
      t.deps,
      { ...job, identitySource: "host", hostSubject: "host-subject-1" },
      returned,
      1,
    );
    const row = (await auditFor(t, ack.correlationId)).find((a) => a.type === "sourceResponded");
    expect(row).toMatchObject({ identitySource: "host", hostSubject: "host-subject-1" });
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
