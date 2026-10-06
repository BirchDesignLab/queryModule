import { AUDIT_DETAILS_SCHEMAS, SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { auditEvent, sourceResult } from "../../src/db/schema";
import type { DispatchJob } from "../../src/dispatch/dispatcher";
import { recordOutcome } from "../../src/dispatch/outcome";
import { sweepPending } from "../../src/dispatch/sweep";
import { manualTime } from "../helpers/manual-time";
import { createTestApp, type TestApp } from "../helpers/test-app";

// Spec 10.4 "Audit fields", 4.7 (SEC-010, SEC-011, SEC-012): every envelope column and details
// field of the dispatch rows, sourceResponded and interrupted, asserted whole on the stored row.
// Extends test/dispatch/outcome.test.ts (sourceResponded details on returned rows, the owner in
// the envelope) and sweep.test.ts (interrupted on seeded rows): here the rows come from real
// submits, every outcome kind, a delegated job, and a monotonic clock that runs apart from the
// wall clock, so latencyMs is shown to come from the acknowledgment's monotonic reading.
const EMAIL = "audit-rows@example.test";
const PASSWORD = "correct-horse-battery-1";
const NOW = 1_790_000_000_000;
const OFFICER = "user-officer-1";
const DELEGATION = "0199a0b0-0000-7000-8000-0000000000e1";

async function setup() {
  const time = manualTime(NOW);
  // The monotonic clock is the manual one plus a skew a test can move without touching the wall
  // clock or any timer: a latency read from the wall clock would miss the skew.
  const mono = { skew: 0 };
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: { nowMs: () => time.monotonic.nowMs() + mono.skew },
    random: () => 0,
  });
  const userId = await t.createUser(EMAIL, PASSWORD);
  const cookie = await t.cookieFor(EMAIL, PASSWORD);
  const jobs: DispatchJob[] = [];
  const enqueue = t.deps.dispatcher.enqueue.bind(t.deps.dispatcher);
  const enqueueSpy = vi.spyOn(t.deps.dispatcher, "enqueue").mockImplementation((js) => {
    jobs.push(...js);
    return enqueue(js);
  });
  async function submit(plate: string, sourceIds: string[]) {
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
        configHash: t.deps.config.current().configHash,
      }),
    });
    expect(r.status).toBe(202);
    return SubmitQueryResponseSchema.parse(await r.json());
  }
  const idle = () => vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
  return { t, time, mono, userId, jobs, enqueueSpy, submit, idle };
}

/** Every audit row of one correlation, in id order. */
async function auditOf(t: TestApp, correlationId: string) {
  return t.deps.db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.correlationId, correlationId))
    .orderBy(asc(auditEvent.id));
}

async function resultsOf(t: TestApp, correlationId: string) {
  return t.deps.db.select().from(sourceResult).where(eq(sourceResult.correlationId, correlationId));
}

/** The result id of the (part 0) row for sourceId. */
async function resultIdOf(t: TestApp, correlationId: string, sourceId: string): Promise<string> {
  const row = (await resultsOf(t, correlationId)).find((r) => r.sourceId === sourceId);
  if (!row) throw new Error(`no ${sourceId} row`);
  return row.resultId;
}

/** Integer ids, ascending in write order, and the details exactly the frozen strict schema. */
function expectWellFormed(rows: { id: number; type: string; details: unknown }[]): void {
  const ids = rows.map((r) => r.id);
  for (const id of ids) expect(Number.isInteger(id)).toBe(true);
  expect(ids).toEqual([...ids].sort((a, b) => a - b));
  expect(new Set(ids).size).toBe(ids.length);
  for (const r of rows) {
    if (r.type !== "sourceResponded" && r.type !== "interrupted") continue;
    expect(AUDIT_DETAILS_SCHEMAS[r.type].parse(r.details)).toEqual(r.details);
  }
}

describe("spec 10.4 audit fields: sourceResponded (SEC-010, SEC-011, SEC-012)", () => {
  it("failed, returned and timedOut rows: every column, latency from the monotonic acknowledgment", async () => {
    const { t, time, mono, userId, submit, idle } = await setup();
    // FAIL1: stateSource fails at 50 ms; nationalSource answers its default at 100 ms
    const a = await submit("FAIL1", ["stateSource", "nationalSource"]);
    // TIMEOUT: nationalSource never answers; its deadline is ack + timeoutMs (10 000 ms)
    const b = await submit("TIMEOUT", ["nationalSource"]);
    expect(b.acknowledgedAt).toBe(a.acknowledgedAt);
    // the monotonic clock runs 7 s ahead of the wall clock from here on
    mono.skew = 7000;
    await time.run(10_000);
    await idle();

    const auditA = await auditOf(t, a.correlationId);
    const auditB = await auditOf(t, b.correlationId);
    const actorRole = auditA.find((r) => r.type === "submitted")?.actorRole;
    expect(actorRole).toBe("user");
    const envelope = (correlationId: string, at: number) => ({
      type: "sourceResponded",
      at,
      correlationId,
      partId: 0,
      actorUserId: userId,
      actorEmail: EMAIL,
      actorRole: "user",
      credentialUserId: null,
      identitySource: "local",
      hostSubject: null,
    });
    const details = (sourceId: string, resultId: string, status: string, latencyMs: number) => ({
      partId: 0,
      sourceId,
      resultId,
      status,
      latencyMs,
      credentialOwnerUserId: null,
      delegationId: null,
      adapterKind: "mock",
    });
    const state = await resultIdOf(t, a.correlationId, "stateSource");
    const national = await resultIdOf(t, a.correlationId, "nationalSource");
    const timedOut = await resultIdOf(t, b.correlationId, "nationalSource");
    const strip = (rows: typeof auditA) =>
      rows.filter((r) => r.type === "sourceResponded").map(({ id: _id, ...r }) => r);
    expect(strip(auditA)).toEqual([
      {
        ...envelope(a.correlationId, NOW + 50),
        details: { ...details("stateSource", state, "failed", 7050), errorCode: "failed" },
      },
      {
        ...envelope(a.correlationId, NOW + 100),
        details: details("nationalSource", national, "returned", 7100),
      },
    ]);
    expect(strip(auditB)).toEqual([
      {
        ...envelope(b.correlationId, NOW + 10_000),
        details: details("nationalSource", timedOut, "timedOut", 17_000),
      },
    ]);
    // sourceResponded follows acknowledged in the correlation's id order
    expect(auditA.map((r) => r.type)).toEqual([
      "submitted",
      "sourceDispatched",
      "sourceDispatched",
      "acknowledged",
      "sourceResponded",
      "sourceResponded",
    ]);
    expectWellFormed(auditA);
    expectWellFormed(auditB);
    expect(t.fatals).toEqual([]);
  });

  it("a delegated job: the requester is the actor, the owner and the delegation are named (SEC-011)", async () => {
    const { t, time, mono, userId, jobs, enqueueSpy, submit } = await setup();
    // capture only: the test settles the job itself, as the M3 credential path will
    enqueueSpy.mockImplementation((js) => {
      jobs.push(...js);
      return true;
    });
    const ack = await submit("ZZ-0001", ["stateSource"]);
    const job = jobs[0];
    if (!job) throw new Error("no job");
    time.clock.advance(250);
    mono.skew = 30;
    await recordOutcome(
      t.deps,
      { ...job, credentialUserId: OFFICER, delegationId: DELEGATION },
      { status: "credentialsRejected", errorCode: "credentialsRejected" },
      t.deps.monotonic.nowMs() - job.acknowledgedMonoMs,
    );

    const rows = (await auditOf(t, ack.correlationId)).filter((r) => r.type === "sourceResponded");
    expect(rows.map(({ id: _id, ...r }) => r)).toEqual([
      {
        type: "sourceResponded",
        at: NOW + 250,
        correlationId: ack.correlationId,
        partId: 0,
        actorUserId: userId,
        actorEmail: EMAIL,
        actorRole: "user",
        credentialUserId: OFFICER,
        identitySource: "local",
        hostSubject: null,
        details: {
          partId: 0,
          sourceId: "stateSource",
          resultId: job.resultId,
          status: "credentialsRejected",
          latencyMs: 280,
          credentialOwnerUserId: OFFICER,
          delegationId: DELEGATION,
          adapterKind: "mock",
          errorCode: "credentialsRejected",
        },
      },
    ]);
    expectWellFormed(rows);
    expect(t.fatals).toEqual([]);
  });
});

describe("spec 10.4 audit fields: interrupted (SEC-010, SEC-012, spec 5.2 startup sweep)", () => {
  it("a real submit's pending rows: the system actor, the row's owner and reason processRestart", async () => {
    const { t, time, submit } = await setup();
    // no time runs: both sources stay pending, as after a crash
    const ack = await submit("ZZ-0001", ["stateSource", "nationalSource"]);
    time.clock.advance(5000);
    expect(await sweepPending(t.deps)).toEqual({ interrupted: 2, pruned: 0 });

    const audit = await auditOf(t, ack.correlationId);
    const results = await resultsOf(t, ack.correlationId);
    expect(results.map((r) => r.status)).toEqual(["interrupted", "interrupted"]);
    const interrupted = audit.filter((r) => r.type === "interrupted");
    expect(interrupted.map(({ id: _id, ...r }) => r)).toEqual(
      [...results]
        .sort((x, y) => (x.resultId < y.resultId ? -1 : 1))
        .map((r) => ({
          type: "interrupted",
          at: NOW + 5000,
          correlationId: ack.correlationId,
          partId: 0,
          actorUserId: "system",
          actorEmail: null,
          actorRole: "system",
          credentialUserId: r.credentialUserId,
          identitySource: "system",
          hostSubject: null,
          details: {
            partId: 0,
            sourceId: r.sourceId,
            resultId: r.resultId,
            reason: "processRestart",
          },
        })),
    );
    expect(audit.map((r) => r.type)).toEqual([
      "submitted",
      "sourceDispatched",
      "sourceDispatched",
      "acknowledged",
      "interrupted",
      "interrupted",
    ]);
    expectWellFormed(audit);
  });
});
