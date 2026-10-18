import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { auditEvent, eventLog, session } from "../../src/db/schema";
import { withTransaction } from "../../src/db/tx";
import type { AppDeps } from "../../src/deps";
import { appendEvent, EVENT_LOG_RETENTION_MS } from "../../src/dispatch/event-log";
import {
  createSweeper,
  EVENT_LOG_PRUNE_EVERY_MS,
  SWEEP_INTERVAL_MS,
  SWEEP_SESSION_BATCH,
} from "../../src/dispatch/sweeper";
import { uuidv7 } from "../../src/ids";
import { manualTime, settle } from "../helpers/manual-time";
import { createTestApp } from "../helpers/test-app";

// Spec 5.2 sweeper steps c and d, 5.3 (close on expiry), 5.6 (SEC-005), 4.7 sessionRevoked
// (SEC-010), #511 AUD-1, D-M2P2-3, D-A14: every tick expires the sessions past their live limits,
// each in its own transaction with one sessionRevoked row by the system actor, closes their
// sockets after commit, and once an hour prunes event_log.
const NOW = 1_790_000_000_000;
const MIN = 60_000;
const PASSWORD = "correct-horse-battery-1";

async function setup() {
  const time = manualTime(NOW);
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
  });
  const userId = await t.createUser("sweeper@example.test", PASSWORD);
  return { t, time, d: t.deps, userId };
}

/** One session row as Better Auth stores it, with the given created and last-activity times. */
async function insertSession(
  d: AppDeps,
  userId: string,
  o: { createdAt: number; updatedAt: number },
): Promise<string> {
  const id = uuidv7(o.createdAt);
  await d.db.insert(session).values({
    id,
    userId,
    token: uuidv7(o.createdAt),
    expiresAt: new Date(NOW + 7 * 24 * 60 * MIN),
    createdAt: new Date(o.createdAt),
    updatedAt: new Date(o.updatedAt),
  });
  return id;
}

async function sessionIds(d: AppDeps): Promise<string[]> {
  const rows = await d.db.select({ id: session.id }).from(session).orderBy(asc(session.id));
  return rows.map((r) => r.id);
}

const revokedRows = (d: AppDeps) =>
  d.db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.type, "sessionRevoked"))
    .orderBy(asc(auditEvent.id));

function expiredRow(sessionId: string, userId: string, at: number) {
  return {
    type: "sessionRevoked",
    at,
    correlationId: null,
    partId: null,
    actorUserId: "system",
    actorEmail: null,
    actorRole: "system",
    credentialUserId: null,
    identitySource: "system",
    hostSubject: null,
    details: { sessionId, targetUserId: userId, reason: "expired" },
  };
}

describe("createSweeper: session expiry (spec 5.2 step c, 5.6, SEC-005, SEC-010)", () => {
  it("deletes an idle-expired and an absolute-expired session, one sessionRevoked each, endSession after commit; a live session is untouched", async () => {
    const { t, d, userId } = await setup();
    const idle = await insertSession(d, userId, {
      createdAt: NOW - 60 * MIN,
      updatedAt: NOW - 30 * MIN,
    });
    const absolute = await insertSession(d, userId, {
      createdAt: NOW - 720 * MIN,
      updatedAt: NOW - MIN,
    });
    const live = await insertSession(d, userId, {
      createdAt: NOW - 719 * MIN,
      updatedAt: NOW - 29 * MIN,
    });
    const ended: string[] = [];
    const seenAtEnd: Promise<{ rows: number; audits: number }>[] = [];
    for (const id of [idle, absolute, live]) {
      d.eventBus.onSessionEnded(id, () => {
        ended.push(id);
        // runs after the commit: the row is gone and its audit row is there
        seenAtEnd.push(
          (async () => ({
            rows: (await d.db.select().from(session).where(eq(session.id, id))).length,
            audits: (await revokedRows(d)).filter(
              (r) => (r.details as { sessionId: string }).sessionId === id,
            ).length,
          }))(),
        );
      });
    }

    const r = await createSweeper(d).tick(NOW);

    expect(r).toEqual({ expired: 2, pruned: 0, failed: 0 });
    expect(await sessionIds(d)).toEqual([live]);
    const rows = await revokedRows(d);
    expect(rows).toHaveLength(2);
    expect(rows.map(({ id: _id, ...x }) => x)).toEqual(
      expect.arrayContaining([idle, absolute].map((id) => expiredRow(id, userId, NOW))),
    );
    expect(ended.sort()).toEqual([idle, absolute].sort());
    expect(await Promise.all(seenAtEnd)).toEqual([
      { rows: 0, audits: 1 },
      { rows: 0, audits: 1 },
    ]);
    expect(t.fatals).toEqual([]);
  });

  it("reads the live limits each tick: a published shorter idle limit expires a session on the next tick", async () => {
    const { d, userId } = await setup();
    const id = await insertSession(d, userId, {
      createdAt: NOW - 20 * MIN,
      updatedAt: NOW - 10 * MIN,
    });
    const sweeper = createSweeper(d);
    expect((await sweeper.tick(NOW)).expired).toBe(0);
    const cur = d.config.current();
    const siteConfig = {
      ...cur.siteConfig,
      auth: { ...cur.siteConfig.auth, session: { ...cur.siteConfig.auth.session, idleMinutes: 5 } },
    };
    d.config.swap({ ...cur, siteConfig });

    expect((await sweeper.tick(NOW + MIN)).expired).toBe(1);
    expect(await sessionIds(d)).toEqual([]);
    expect((await revokedRows(d)).map((r) => r.details)).toEqual([
      { sessionId: id, targetUserId: userId, reason: "expired" },
    ]);
  });

  it("an audit write that throws keeps the session, writes nothing, logs ids only, never calls fatal; the next tick succeeds", async () => {
    const { t, d, userId } = await setup();
    const id = await insertSession(d, userId, {
      createdAt: NOW - 60 * MIN,
      updatedAt: NOW - 45 * MIN,
    });
    const ended: string[] = [];
    d.eventBus.onSessionEnded(id, () => ended.push(id));
    const real = d.audit;
    d.audit = {
      record: async () => {
        throw new TypeError("audit down zz-secret-text");
      },
    };
    const sweeper = createSweeper(d);

    expect(await sweeper.tick(NOW)).toEqual({ expired: 0, pruned: 0, failed: 1 });
    expect(await sessionIds(d)).toEqual([id]);
    expect(await revokedRows(d)).toEqual([]);
    expect(ended).toEqual([]);
    expect(t.fatals).toEqual([]);
    const failLines = t.logLines.filter((l) => l.includes("session expiry failed"));
    expect(failLines).toHaveLength(1);
    expect(failLines[0]).toContain(id);
    expect(failLines[0]).toContain("TypeError");
    expect(t.logLines.join("\n")).not.toContain("zz-secret-text");

    d.audit = real;
    expect(await sweeper.tick(NOW + MIN)).toEqual({ expired: 1, pruned: null, failed: 0 });
    expect(await sessionIds(d)).toEqual([]);
    expect(ended).toEqual([id]);
  });

  it(`expires at most ${SWEEP_SESSION_BATCH} sessions per tick: one more takes a second tick`, async () => {
    const { d, userId } = await setup();
    const values = Array.from({ length: SWEEP_SESSION_BATCH + 1 }, (_, i) => ({
      id: uuidv7(NOW - 60 * MIN + i),
      userId,
      token: uuidv7(NOW - 60 * MIN + i),
      expiresAt: new Date(NOW + 60 * MIN),
      createdAt: new Date(NOW - 60 * MIN + i),
      updatedAt: new Date(NOW - 40 * MIN),
    }));
    await d.db.insert(session).values(values);
    const sweeper = createSweeper(d);

    expect((await sweeper.tick(NOW)).expired).toBe(SWEEP_SESSION_BATCH);
    expect(await sessionIds(d)).toHaveLength(1);
    expect((await sweeper.tick(NOW + MIN)).expired).toBe(1);
    expect(await sessionIds(d)).toEqual([]);
    expect(await revokedRows(d)).toHaveLength(SWEEP_SESSION_BATCH + 1);
  }, 60_000);

  it("removes an orphan session (its loginSucceeded row failed, its delete failed, never used) at idle expiry (D-M2P2-3)", async () => {
    const { time, d, userId } = await setup();
    // created and never refreshed, with no loginSucceeded row
    const id = await insertSession(d, userId, {
      createdAt: NOW - 29 * MIN,
      updatedAt: NOW - 29 * MIN,
    });
    const sweeper = createSweeper(d);
    expect((await sweeper.tick(NOW)).expired).toBe(0);
    time.clock.advance(MIN);
    expect((await sweeper.tick(d.clock.now())).expired).toBe(1);
    expect(await sessionIds(d)).toEqual([]);
    expect((await revokedRows(d)).map(({ id: _id, ...x }) => x)).toEqual([
      expiredRow(id, userId, NOW + MIN),
    ]);
  });

  it("a session signed out between the select and the delete gets no sessionRevoked row and is not counted", async () => {
    const { t, d, userId } = await setup();
    const id = await insertSession(d, userId, {
      createdAt: NOW - 60 * MIN,
      updatedAt: NOW - 45 * MIN,
    });
    const ended: string[] = [];
    d.eventBus.onSessionEnded(id, () => ended.push(id));
    const original = d.db.transaction.bind(d.db);
    // the first transaction is this session's: a sign-out (or admin revoke, or user disable)
    // deletes the row first
    vi.spyOn(d.db, "transaction").mockImplementationOnce(async (fn, config) => {
      await d.db.delete(session).where(eq(session.id, id));
      return original(fn, config);
    });

    expect(await createSweeper(d).tick(NOW)).toEqual({ expired: 0, pruned: 0, failed: 0 });
    vi.mocked(d.db.transaction).mockRestore();
    expect(await revokedRows(d)).toEqual([]);
    expect(ended).toEqual([]);
    expect(t.fatals).toEqual([]);
  });

  it("a session refreshed between the select and the delete stays, with no sessionRevoked row", async () => {
    const { d, userId } = await setup();
    const id = await insertSession(d, userId, {
      createdAt: NOW - 60 * MIN,
      updatedAt: NOW - 45 * MIN,
    });
    const original = d.db.transaction.bind(d.db);
    vi.spyOn(d.db, "transaction").mockImplementationOnce(async (fn, config) => {
      await d.db
        .update(session)
        .set({ updatedAt: new Date(NOW) })
        .where(eq(session.id, id));
      return original(fn, config);
    });

    expect((await createSweeper(d).tick(NOW)).expired).toBe(0);
    vi.mocked(d.db.transaction).mockRestore();
    expect(await sessionIds(d)).toEqual([id]);
    expect(await revokedRows(d)).toEqual([]);
  });
});

describe("createSweeper: hourly event_log prune (spec 5.2 step d, 5.3, D-A14)", () => {
  const OLD = NOW - EVENT_LOG_RETENTION_MS - 1;
  const row = (userId: string, n: number, createdAt: number) => ({
    userId,
    type: "sourceStatus" as const,
    correlationId: `0199a0b0-0000-7000-8000-0000000000c${n}`,
    partId: 0,
    sourceId: "stateSource",
    resultId: `0199a0b0-0000-7000-8000-0000000000d${n}`,
    status: "returned" as const,
    createdAt,
  });
  const append = (d: AppDeps, r: ReturnType<typeof row>) =>
    withTransaction(d.db, (tx) => appendEvent(tx, r));
  const seqsOf = async (d: AppDeps, userId: string) =>
    (
      await d.db
        .select({ seq: eventLog.seq })
        .from(eventLog)
        .where(eq(eventLog.userId, userId))
        .orderBy(asc(eventLog.seq))
    ).map((r) => r.seq);

  it("prunes once per hour, keeping each user's newest row", async () => {
    const { d } = await setup();
    await append(d, row("user-prune-a", 1, OLD));
    await append(d, row("user-prune-a", 2, OLD));
    await append(d, row("user-prune-b", 3, OLD));
    const sweeper = createSweeper(d);

    expect(await sweeper.tick(NOW)).toEqual({ expired: 0, pruned: 1, failed: 0 });
    expect(await seqsOf(d, "user-prune-a")).toEqual([2]);
    expect(await seqsOf(d, "user-prune-b")).toEqual([1]);

    await append(d, row("user-prune-a", 4, OLD));
    for (let at = NOW + MIN; at < NOW + EVENT_LOG_PRUNE_EVERY_MS; at += MIN) {
      expect((await sweeper.tick(at)).pruned).toBeNull();
    }
    expect(await seqsOf(d, "user-prune-a")).toEqual([2, 3]);
    expect((await sweeper.tick(NOW + EVENT_LOG_PRUNE_EVERY_MS)).pruned).toBe(1);
    expect(await seqsOf(d, "user-prune-a")).toEqual([3]);
    expect(await seqsOf(d, "user-prune-b")).toEqual([1]);
  }, 30_000);
});

describe("createSweeper: start and stop (spec 5.2)", () => {
  it("a prune that fails logs the error class, returns pruned null and runs again on the next tick", async () => {
    const { t, d } = await setup();
    // no session is due, so the first transaction is the prune
    vi.spyOn(d.db, "transaction").mockImplementationOnce(async () => {
      throw new RangeError("prune down zz-secret-text");
    });
    const sweeper = createSweeper(d);
    expect(await sweeper.tick(NOW)).toEqual({ expired: 0, pruned: null, failed: 0 });
    vi.mocked(d.db.transaction).mockRestore();
    const lines = t.logLines.filter((l) => l.includes("event log prune failed"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("RangeError");
    expect(t.logLines.join("\n")).not.toContain("zz-secret-text");
    expect(await sweeper.tick(NOW + MIN)).toEqual({ expired: 0, pruned: 0, failed: 0 });
    expect(t.fatals).toEqual([]);
  });

  it(`ticks every ${SWEEP_INTERVAL_MS} ms on d.timers, skips an interval while a tick still runs, and stop waits for it`, async () => {
    const { time, d, userId } = await setup();
    await insertSession(d, userId, { createdAt: NOW - 60 * MIN, updatedAt: NOW - 45 * MIN });
    const real = d.audit;
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    d.audit = {
      record: async (tx, e) => {
        calls += 1;
        await gate;
        return real.record(tx, e);
      },
    };
    // each tick reads the live limits once, so this counts the ticks that started
    const ticks = vi.spyOn(d.config, "current");
    const sweeper = createSweeper(d);
    sweeper.start();
    await time.run(SWEEP_INTERVAL_MS - 1);
    expect(calls).toBe(0);
    await time.run(1);
    expect(calls).toBe(1);
    expect(ticks).toHaveBeenCalledTimes(1);
    // the tick is still blocked in its transaction: the next two intervals are skipped
    await time.run(2 * SWEEP_INTERVAL_MS);
    expect(calls).toBe(1);
    expect(ticks).toHaveBeenCalledTimes(1);

    const stopped = sweeper.stop();
    release();
    await stopped;
    expect(time.timerCount()).toBe(0);
    expect(calls).toBe(1);
    expect(await sessionIds(d)).toEqual([]);
    expect(await revokedRows(d)).toHaveLength(1);
    // stopped: no tick runs again
    await time.run(5 * SWEEP_INTERVAL_MS);
    await settle();
    expect(calls).toBe(1);
  });
  it("a tick whose session select fails logs the error class and the next interval ticks again", async () => {
    const { t, time, d, userId } = await setup();
    await insertSession(d, userId, { createdAt: NOW - 60 * MIN, updatedAt: NOW - 45 * MIN });
    vi.spyOn(d.db, "select").mockImplementationOnce(() => {
      throw new TypeError("select down zz-secret-text");
    });
    const sweeper = createSweeper(d);
    sweeper.start();
    await time.run(SWEEP_INTERVAL_MS);
    vi.mocked(d.db.select).mockRestore();
    const lines = t.logLines.filter((l) => l.includes("sweeper tick failed"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("TypeError");
    expect(t.logLines.join("\n")).not.toContain("zz-secret-text");
    await time.run(SWEEP_INTERVAL_MS);
    await sweeper.stop();
    expect(await sessionIds(d)).toEqual([]);
    expect(await revokedRows(d)).toHaveLength(1);
    expect(t.fatals).toEqual([]);
  });
  it("stop before start is a no-op, and a second start schedules no second timer", async () => {
    const { time, d } = await setup();
    const sweeper = createSweeper(d);
    await sweeper.stop();
    expect(time.timerCount()).toBe(0);
    const ticks = vi.spyOn(d.config, "current");
    sweeper.start();
    sweeper.start();
    expect(time.timerCount()).toBe(1);
    await time.run(SWEEP_INTERVAL_MS);
    expect(ticks).toHaveBeenCalledTimes(1);
    await sweeper.stop();
    expect(time.timerCount()).toBe(0);
  });
});
