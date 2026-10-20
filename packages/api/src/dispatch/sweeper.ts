import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { and, asc, eq, lte, notInArray, or } from "drizzle-orm";
import { session } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { errorFields } from "../log/error-fields";
import { pruneEventLog } from "./event-log";

/** Spec 5.2: the sweeper's tick interval. */
export const SWEEP_INTERVAL_MS = 60_000;
/** Spec 5.2 step d, 5.3 (D-A14): event_log is pruned once an hour. */
export const EVENT_LOG_PRUNE_EVERY_MS = 3_600_000;
/** Due sessions are selected this many at a time (#760 C-m2). */
export const SWEEP_SESSION_BATCH = 500;
/** At most this many batches per tick (2,000 sessions); the rest wait for the next tick. */
export const SWEEP_MAX_BATCHES_PER_TICK = 4;

/** One tick: sessions expired, event_log rows pruned (null: no prune this tick), sessions failed. */
export type SweepTick = { expired: number; pruned: number | null; failed: number };

/**
 * The running sweeper (spec 5.2). Steps a and b (expire delegations, delete their credentials)
 * and step c's delegation revoke are M3 P3; this tick runs step c's session expiry and step d.
 *
 * Step c (spec 5.6, SEC-020, SEC-010; #511 AUD-1): the live limits are read from
 * d.config.current() each tick, so a publish applies on the next tick. A session is due when
 * now - created_at >= absoluteMinutes or now - updated_at >= idleMinutes (identity's live test,
 * negated). Each due session gets its own transaction: delete it with the same condition, and
 * only when exactly one row went, write sessionRevoked reason expired by SYSTEM_ACTOR. Zero rows
 * means a sign-out, admin revoke, user disable or fresh activity got there first: nothing is
 * written and the session is not counted. Only after a successful commit does eventBus.endSession
 * close its sockets (4001, spec 5.3); an endSession that throws is logged by error class and the
 * session still counts as expired. A failed transaction leaves the session in place (identity
 * already refuses it, so no access is granted), logs the session id and error class only (spec
 * 5.9), and the next tick retries it; the sweeper never calls d.fatal. D-M2P2-3: a session whose
 * loginSucceeded row failed and whose delete failed is never refreshed, so the idle pass removes it.
 *
 * Batches (#760 C-m2): a tick selects up to SWEEP_SESSION_BATCH due sessions, leaving out the ids
 * that failed earlier in the same tick, and selects again while the last batch was full, at most
 * SWEEP_MAX_BATCHES_PER_TICK times. The skip set lives for one tick, so failing rows cannot starve
 * the rest and are still retried on the next tick.
 *
 * Step d (D-A14): once per pruneEveryMs, pruneEventLog in its own transaction.
 *
 * Drain (#760 C-m1): stop() sets a flag the tick checks before each session and before the prune,
 * so a drain waits for at most one session transaction. The flag is separate from the timer state:
 * a direct tick() on a sweeper that was never started runs every batch.
 *
 * Time comes from d.clock and d.timers only; one tick runs at a time, and an interval that fires
 * while a tick still runs is skipped.
 */
export function createSweeper(
  d: AppDeps,
  o: { intervalMs?: number; pruneEveryMs?: number } = {},
): { start(): void; stop(): Promise<void>; tick(now: number): Promise<SweepTick> } {
  const intervalMs = o.intervalMs ?? SWEEP_INTERVAL_MS;
  const pruneEveryMs = o.pruneEveryMs ?? EVENT_LOG_PRUNE_EVERY_MS;
  let lastPruneAt: number | null = null;
  let timer: unknown = null;
  let stopped = true;
  // set only by stop() and cleared by start(): the tick checks it between sessions
  let halted = false;
  let running: Promise<unknown> | null = null;

  async function expireSessions(now: number): Promise<{ expired: number; failed: number }> {
    const { absoluteMinutes, idleMinutes } = d.config.current().siteConfig.auth.session;
    const due = or(
      lte(session.createdAt, new Date(now - absoluteMinutes * 60_000)),
      lte(session.updatedAt, new Date(now - idleMinutes * 60_000)),
    );
    const skip = new Set<string>();
    let expired = 0;
    let failed = 0;
    for (let batch = 0; batch < SWEEP_MAX_BATCHES_PER_TICK && !halted; batch += 1) {
      const rows = await d.db
        .select({ id: session.id })
        .from(session)
        .where(skip.size === 0 ? due : and(due, notInArray(session.id, [...skip])))
        .orderBy(asc(session.createdAt), asc(session.id))
        .limit(SWEEP_SESSION_BATCH);
      for (const { id } of rows) {
        if (halted) break;
        let gone: boolean;
        try {
          gone = await withTransaction(d.db, async (tx) => {
            const deleted = await tx
              .delete(session)
              .where(and(eq(session.id, id), due))
              .returning({ userId: session.userId });
            // id is the primary key: at most one row goes; none means someone got there first
            const owner = deleted[0];
            if (!owner) return false;
            await d.audit.record(tx, {
              type: "sessionRevoked",
              actor: SYSTEM_ACTOR,
              identitySource: "system",
              details: { sessionId: id, targetUserId: owner.userId, reason: "expired" },
            });
            return true;
          });
        } catch (e) {
          failed += 1;
          skip.add(id);
          d.logger.error("session expiry failed", {
            sessionId: id,
            error: { name: errorFields(e).name },
          });
          continue;
        }
        if (!gone) continue;
        // committed: the session is expired whatever happens to its sockets
        expired += 1;
        try {
          d.eventBus.endSession(id);
        } catch (e) {
          d.logger.error("session close failed", {
            sessionId: id,
            error: { name: errorFields(e).name },
          });
        }
      }
      if (rows.length < SWEEP_SESSION_BATCH) break;
    }
    return { expired, failed };
  }

  async function prune(now: number): Promise<number | null> {
    if (lastPruneAt !== null && now - lastPruneAt < pruneEveryMs) return null;
    try {
      const pruned = await withTransaction(d.db, (tx) => pruneEventLog(tx, now));
      lastPruneAt = now;
      return pruned;
    } catch (e) {
      // retried on the next tick: lastPruneAt is unchanged
      d.logger.error("event log prune failed", { error: { name: errorFields(e).name } });
      return null;
    }
  }

  async function tick(now: number): Promise<SweepTick> {
    const { expired, failed } = await expireSessions(now);
    // a drain does not wait on the prune transaction either
    const pruned = halted ? null : await prune(now);
    return { expired, pruned, failed };
  }

  function fire(): void {
    // stop() clears the pending timer, so fire never runs once stopped
    timer = d.timers.setTimeout(fire, intervalMs);
    if (running) return;
    running = tick(d.clock.now())
      .catch((e: unknown) => {
        // the session select failed: nothing changed, the next tick tries again
        d.logger.error("sweeper tick failed", { error: { name: errorFields(e).name } });
      })
      .finally(() => {
        running = null;
      });
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      halted = false;
      timer = d.timers.setTimeout(fire, intervalMs);
    },
    async stop() {
      stopped = true;
      halted = true;
      if (timer !== null) d.timers.clearTimeout(timer);
      timer = null;
      await running;
    },
    tick,
  };
}
