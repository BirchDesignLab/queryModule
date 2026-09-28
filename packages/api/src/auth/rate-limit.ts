import { getConnInfo } from "@hono/node-server/conninfo";
import { ClientIpSchema } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Clock } from "../clock";
import type { Db } from "../db/client";
import { rateLimit } from "../db/schema";
import { type Tx, withTransaction } from "../db/tx";
import type { DeployEnv } from "../env";
import type { AppEnv } from "../http/types";

const MIN = 60_000;
export const AUTH_LIMITS = {
  accountFailures: { limit: 10, windowMs: 15 * MIN, lockMs: 15 * MIN },
  ipRequests: { limit: 100, windowMs: 15 * MIN },
} as const;

export interface RateLimiter {
  hit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  lockedUntil(key: string): Promise<number | null>;
  recordFailure(
    key: string,
    o: { limit: number; windowMs: number; lockMs: number },
  ): Promise<{ lockedUntil: number | null }>;
  reset(key: string): Promise<void>;
}

export function createRateLimiter(db: Db, clock: Clock): RateLimiter {
  async function bump(tx: Tx, key: string, windowMs: number, now: number) {
    const row = (await tx.select().from(rateLimit).where(eq(rateLimit.key, key)))[0];
    if (!row || now - row.windowStart >= windowMs) {
      const next = { key, windowStart: now, count: 1, lockedUntil: row?.lockedUntil ?? null };
      await tx
        .insert(rateLimit)
        .values(next)
        .onConflictDoUpdate({ target: rateLimit.key, set: next });
      return next;
    }
    const next = { ...row, count: row.count + 1 };
    await tx.update(rateLimit).set({ count: next.count }).where(eq(rateLimit.key, key));
    return next;
  }
  return {
    hit: (key, limit, windowMs) =>
      withTransaction(db, async (tx) => {
        const now = clock.now();
        const r = await bump(tx, key, windowMs, now);
        return {
          allowed: r.count <= limit,
          retryAfterSeconds: Math.ceil((r.windowStart + windowMs - now) / 1000),
        };
      }),
    async lockedUntil(key) {
      const row = (await db.select().from(rateLimit).where(eq(rateLimit.key, key)))[0];
      return row?.lockedUntil != null && row.lockedUntil > clock.now() ? row.lockedUntil : null;
    },
    recordFailure: (key, o) =>
      withTransaction(db, async (tx) => {
        const now = clock.now();
        const r = await bump(tx, key, o.windowMs, now);
        const alreadyLocked = r.lockedUntil !== null && r.lockedUntil > now;
        if (r.count < o.limit || alreadyLocked) return { lockedUntil: null };
        const lockedUntil = now + o.lockMs;
        await tx
          .update(rateLimit)
          .set({ lockedUntil, count: 0, windowStart: now })
          .where(eq(rateLimit.key, key));
        return { lockedUntil };
      }),
    async reset(key) {
      await db.delete(rateLimit).where(eq(rateLimit.key, key));
    },
  };
}

/**
 * Resolves the client IP for rate limiting and login audit (spec 5.6, #104 C-M1).
 * CF-Connecting-IP is trusted only in production (cloudflared is the sole ingress); otherwise
 * the socket address is used. Whatever the source, the result is validated against
 * ClientIpSchema before it is returned, so a malformed or oversized header value can never
 * reach the login audit write and make it throw: it becomes "unknown" instead.
 */
export function clientIp(c: Context<AppEnv>, env: DeployEnv): string {
  const candidate = resolveCandidate(c, env);
  return ClientIpSchema.safeParse(candidate).success ? candidate : "unknown";
}

function resolveCandidate(c: Context<AppEnv>, env: DeployEnv): string {
  if (env.nodeEnv === "production") return c.req.header("cf-connecting-ip")?.trim() ?? "unknown";
  try {
    return getConnInfo(c).remote.address ?? "local";
  } catch {
    return "local";
  }
}
