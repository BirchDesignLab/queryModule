import { SubmitQueryResponseSchema, type WsEvent } from "@querymodule/core/contracts";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { auditEvent, eventLog, sourceResult } from "../../src/db/schema";
import type { DispatchJob, Outcome } from "../../src/dispatch/dispatcher";
import { recordOutcome } from "../../src/dispatch/outcome";
import { manualTime } from "../helpers/manual-time";
import { createTestApp } from "../helpers/test-app";

// FR-043, spec 5.2 step 6 and 10.4: a source_result row's status is write-once from pending. The
// source_result_write_once trigger refuses any UPDATE of a settled row, and T2 carries
// WHERE status = 'pending', so a second outcome for a settled row writes nothing at all.
const PASSWORD = "correct-horse-battery-1";
const EMAIL = "write-once@example.test";

async function returnedRow() {
  const time = manualTime();
  // random 0: stateSource answers at its minimum latency, 50 ms
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
  });
  const userId = await t.createUser(EMAIL, PASSWORD);
  const cookie = await t.cookieFor(EMAIL, PASSWORD);
  const published: WsEvent[] = [];
  t.deps.eventBus.subscribe(userId, (e) => published.push(e));
  const jobs: DispatchJob[] = [];
  const enqueue = t.deps.dispatcher.enqueue.bind(t.deps.dispatcher);
  vi.spyOn(t.deps.dispatcher, "enqueue").mockImplementation((js) => {
    jobs.push(...js);
    return enqueue(js);
  });
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
      values: { plate: "ZZ-0002", state: "TX" },
      sourceIds: ["stateSource"],
      mode: "normal",
      configHash: t.deps.config.current().configHash,
    }),
  });
  expect(r.status).toBe(202);
  const ack = SubmitQueryResponseSchema.parse(await r.json());
  await time.run(50);
  await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
  const job = jobs[0];
  if (!job) throw new Error("no job");
  const snapshot = async () => ({
    rows: await t.deps.db
      .select()
      .from(sourceResult)
      .where(eq(sourceResult.correlationId, ack.correlationId)),
    audit: await t.deps.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.correlationId, ack.correlationId))
      .orderBy(asc(auditEvent.id)),
    events: await t.deps.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.userId, userId))
      .orderBy(asc(eventLog.seq)),
    published: published.length,
  });
  const before = await snapshot();
  expect(before.rows.map((x) => x.status)).toEqual(["returned"]);
  expect(before.published).toBe(1);
  return { t, job, snapshot, before };
}

describe("source_result is write-once from pending (FR-043, spec 5.2 step 6, 10.4)", () => {
  it("a direct UPDATE that sets a returned row to failed aborts on the trigger", async () => {
    const { t, job, snapshot, before } = await returnedRow();
    await expect(
      t.deps.db.$client.execute({
        sql: "UPDATE source_result SET status = 'failed', error_code = 'failed' WHERE result_id = ?",
        args: [job.resultId],
      }),
    ).rejects.toThrow(/source_result status is write-once from pending/);
    expect(await snapshot()).toEqual(before);
  });

  it("T2 never overwrites a settled row: later outcomes write, audit and publish nothing", async () => {
    const { t, job, snapshot, before } = await returnedRow();
    const later: Outcome[] = [
      { status: "failed", errorCode: "failed" },
      { status: "credentialsRejected", errorCode: "credentialsRejected" },
      { status: "timedOut" },
      { status: "credentialsMissing" },
      { status: "returned", payload: { status: "NO RECORD" } },
    ];
    for (const o of later) await recordOutcome(t.deps, job, o, 9);
    expect(await snapshot()).toEqual(before);
    expect(t.fatals).toEqual([]);
    expect(t.logLines.join("\n")).not.toContain("dispatch outcome write failed");
  });
});
