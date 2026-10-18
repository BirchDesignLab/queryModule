import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { and, asc, eq, lte, or } from "drizzle-orm";
import { session } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { errorFields } from "../log/error-fields";
import { pruneEventLog } from "./event-log";

/** Spec 5.2: the sweeper's tick interval. */
export const SWEEP_INTERVAL_MS = 60_000;
/** Spec 5.2 step d, 5.3 (D-A14): event_log is pruned once an hour. */
export const EVENT_LOG_PRUNE_EVERY_MS = 3_600_000;
/** At most this many sessions are expired per tick; the rest wait for the next. */
export const SWEEP_SESSION_BATCH = 500;

/** One tick: sessions expired, event_log rows pruned (null: no prune this tick), sessions failed. */
export type SweepTick = { expired: number; pruned: number | null; failed: number };

/**
 * The running sweeper (spec 5.2). Steps a and b (expire delegations, delete their credentials)
 * are M3 P3; this tick runs steps c and d.
 *
 * Step c (spec 5.6, SEC-005, SEC-010; #511 AUD-1): the live limits are read from
 * d.config.current() each tick, so a publish applies on the next tick. A session is due when
 * now - created_at >= absoluteMinutes or now - updated_at >= idleMinutes (identity's live test,
 * negated). Each due session gets its own transaction: delete it with the same condition, and
 * only when exactly one row went, write sessionRevoked reason expired by SYSTEM_ACTOR. Zero rows
 * means a sign-out, admin revoke, user disable or fresh activity got there first: nothing is
 * written and the session is not counted. After commit, eventBus.endSession closes its sockets
 * (4001, spec 5.3). A failed transaction leaves the session in place (identity already refuses
 * it, so no access is granted), logs the session id and error class only (spec 5.9), and the
 * next tick retries it; the sweeper never calls d.fatal. D-M2P2-3: a session whose loginSucceeded
 * row failed and whose delete failed is never refreshed, so the idle pass removes it.
 *
 * Step d (D-A14): once per pruneEveryMs, pruneEventLog in its own transaction.
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
  let running: Promise<unknown> | null = null;

  async function expireSessions(now: number): Promise<{ expired: number; failed: number }> {
    const { absoluteMinutes, idleMinutes } = d.config.current().siteConfig.auth.session;
    const due = or(
      lte(session.createdAt, new Date(now - absoluteMinutes * 60_000)),
      lte(session.updatedAt, new Date(now - idleMinutes * 60_000)),
    );
    const rows = await d.db
      .select({ id: session.id })
      .from(session)
      .where(due)
      .orderBy(asc(session.createdAt), asc(session.id))
      .limit(SWEEP_SESSION_BATCH);
    let expired = 0;
    let failed = 0;
    for (const { id } of rows) {
      try {
        const gone = await withTransaction(d.db, async (tx) => {
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
        if (!gone) continue;
        expired += 1;
        d.eventBus.endSession(id);
      } catch (e) {
        failed += 1;
        d.logger.error("session expiry failed", {
          sessionId: id,
          error: { name: errorFields(e).name },
        });
      }
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
    const pruned = await prune(now);
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
      timer = d.timers.setTimeout(fire, intervalMs);
    },
    async stop() {
      stopped = true;
      if (timer !== null) d.timers.clearTimeout(timer);
      timer = null;
      await running;
    },
    tick,
  };
}
