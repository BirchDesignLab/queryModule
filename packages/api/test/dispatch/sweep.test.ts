import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditEvent, eventLog, sourceResult } from "../../src/db/schema";
import { withTransaction } from "../../src/db/tx";
import type { AppDeps } from "../../src/deps";
import { appendEvent, EVENT_LOG_RETENTION_MS } from "../../src/dispatch/event-log";
import { sweepPending } from "../../src/dispatch/sweep";
import { manualTime } from "../helpers/manual-time";
import { seedResult } from "../helpers/results";
import { createTestApp } from "../helpers/test-app";

// Spec 5.2 "Startup sweep", 4.7 (NFR-003, SEC-010, SEC-012): before the server listens, one
// transaction settles every pending source_result as interrupted, with one interrupted audit row
// per result by the system actor and one event_log row for its owner. Nothing is re-dispatched
// and nothing is published (no socket exists yet); clients get the rows on replay.
const NOW = 1_790_000_000_000;
const USER_A = "user-sweep-a";
const USER_B = "user-sweep-b";
const OWNER = "user-sweep-owner";

async function setup() {
  const time = manualTime(NOW);
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
  });
  const published: unknown[] = [];
  for (const u of [USER_A, USER_B]) t.deps.eventBus.subscribe(u, (e) => published.push(e));
  return { t, time, published };
}

async function eventsOf(d: AppDeps, userId: string) {
  return d.db.select().from(eventLog).where(eq(eventLog.userId, userId)).orderBy(asc(eventLog.seq));
}

async function rowsOf(d: AppDeps, resultIds: string[]) {
  return d.db
    .select()
    .from(sourceResult)
    .where(inArray(sourceResult.resultId, resultIds))
    .orderBy(asc(sourceResult.createdAt));
}

const interruptedAudit = (d: AppDeps) =>
  d.db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.type, "interrupted"))
    .orderBy(asc(auditEvent.id));

describe("sweepPending: pending results become interrupted (spec 5.2, NFR-003, SEC-010, SEC-012)", () => {
  it("settles three pending rows of two users, audits each by the system actor, appends the next seq per owner", async () => {
    const { t, published } = await setup();
    const d = t.deps;
    // user A already has seq 1 in the outbox, so its sweep row takes seq 2
    await withTransaction(d.db, (tx) =>
      appendEvent(tx, {
        userId: USER_A,
        type: "sourceStatus",
        correlationId: "0199a0b0-0000-7000-8000-0000000000c1",
        partId: 0,
        sourceId: "stateSource",
        resultId: "0199a0b0-0000-7000-8000-0000000000d1",
        status: "returned",
        createdAt: NOW - 1000,
      }),
    );
    const a = await seedResult(d.db, { userId: USER_A, createdAt: NOW - 30 });
    const b1 = await seedResult(d.db, {
      userId: USER_B,
      sourceId: "nationalSource",
      createdAt: NOW - 20,
    });
    const b2 = await seedResult(d.db, {
      userId: USER_B,
      credentialUserId: OWNER,
      partId: 1,
      createdAt: NOW - 10,
    });
    const done = await seedResult(d.db, {
      userId: USER_A,
      status: "returned",
      createdAt: NOW - 40,
    });
    const [doneBefore] = await rowsOf(d, [done.resultId]);

    expect(await sweepPending(d)).toEqual({ interrupted: 3, pruned: 0 });

    const rows = await rowsOf(d, [a.resultId, b1.resultId, b2.resultId]);
    expect(rows.map((r) => [r.resultId, r.status, r.receivedAt, r.timedOutAt])).toEqual([
      [a.resultId, "interrupted", NOW, null],
      [b1.resultId, "interrupted", NOW, null],
      [b2.resultId, "interrupted", NOW, null],
    ]);
    // a settled row is untouched
    expect(await rowsOf(d, [done.resultId])).toEqual([doneBefore]);

    const audit = await interruptedAudit(d);
    expect(audit.map(({ id: _id, ...r }) => r)).toEqual(
      [a, b1, b2].map((s) => ({
        type: "interrupted",
        at: NOW,
        correlationId: s.correlationId,
        partId: s.partId,
        actorUserId: "system",
        actorEmail: null,
        actorRole: "system",
        credentialUserId: s.credentialUserId,
        identitySource: "system",
        hostSubject: null,
        details: {
          partId: s.partId,
          sourceId: s.sourceId,
          resultId: s.resultId,
          reason: "processRestart",
        },
      })),
    );

    const event = (s: typeof a, seq: number) => ({
      userId: s.userId,
      seq,
      type: "sourceStatus",
      correlationId: s.correlationId,
      partId: s.partId,
      sourceId: s.sourceId,
      resultId: s.resultId,
      delegationId: null,
      status: "interrupted",
      createdAt: NOW,
    });
    expect((await eventsOf(d, USER_A)).slice(1)).toEqual([event(a, 2)]);
    expect(await eventsOf(d, USER_B)).toEqual([event(b1, 1), event(b2, 2)]);
    // no socket exists yet: nothing is published, and nothing is dispatched
    expect(published).toEqual([]);
    expect(d.dispatcher.inFlight()).toBe(0);
    expect(t.fatals).toEqual([]);
  });

  it("orders one owner's seqs by submit time, then by result id", async () => {
    const { t } = await setup();
    const d = t.deps;
    const late = await seedResult(d.db, { userId: USER_A, createdAt: NOW - 10 });
    const tieA = await seedResult(d.db, { userId: USER_A, createdAt: NOW - 20 });
    const tieB = await seedResult(d.db, {
      userId: USER_A,
      sourceId: "nationalSource",
      createdAt: NOW - 20,
    });
    const [first, second] = [tieA, tieB].sort((x, y) => (x.resultId < y.resultId ? -1 : 1));
    expect(await sweepPending(d)).toEqual({ interrupted: 3, pruned: 0 });
    expect((await eventsOf(d, USER_A)).map((e) => [e.seq, e.resultId])).toEqual([
      [1, first?.resultId],
      [2, second?.resultId],
      [3, late.resultId],
    ]);
  });

  it("with nothing pending writes nothing and still prunes the event log", async () => {
    const { t } = await setup();
    const d = t.deps;
    const old = NOW - EVENT_LOG_RETENTION_MS - 1;
    for (const createdAt of [old, NOW - 5])
      await withTransaction(d.db, (tx) =>
        appendEvent(tx, {
          userId: USER_A,
          type: "sourceStatus",
          correlationId: "0199a0b0-0000-7000-8000-0000000000c1",
          partId: 0,
          sourceId: "stateSource",
          resultId: "0199a0b0-0000-7000-8000-0000000000d1",
          status: "returned",
          createdAt,
        }),
      );
    expect(await sweepPending(d)).toEqual({ interrupted: 0, pruned: 1 });
    expect((await eventsOf(d, USER_A)).map((e) => e.seq)).toEqual([2]);
    expect(await interruptedAudit(d)).toEqual([]);
  });

  it("a failed audit write rolls the whole sweep back: every row stays pending, no audit or event row", async () => {
    const { t } = await setup();
    const seeded = [
      await seedResult(t.deps.db, { userId: USER_A, createdAt: NOW - 20 }),
      await seedResult(t.deps.db, { userId: USER_B, createdAt: NOW - 10 }),
    ];
    let calls = 0;
    const d: AppDeps = {
      ...t.deps,
      audit: {
        record: async (tx, e) => {
          calls += 1;
          // the second row's audit fails after the first row was written in the same transaction
          if (calls === 2) throw new Error("audit store unavailable");
          return t.deps.audit.record(tx, e);
        },
      },
    };
    await expect(sweepPending(d)).rejects.toThrow("audit store unavailable");
    expect(calls).toBe(2);
    const rows = await rowsOf(
      t.deps,
      seeded.map((s) => s.resultId),
    );
    expect(rows.map((r) => [r.status, r.receivedAt])).toEqual([
      ["pending", null],
      ["pending", null],
    ]);
    expect(await interruptedAudit(t.deps)).toEqual([]);
    expect(await eventsOf(t.deps, USER_A)).toEqual([]);
    expect(await eventsOf(t.deps, USER_B)).toEqual([]);
  });
});
