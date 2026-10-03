import { AuditActorSchema, type Role } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import type { Clock } from "../clock";
import type { Db } from "../db/client";
import { session, user } from "../db/schema";
import type { Logger } from "../log/logger";
import type { IdentityService, Principal } from "../seams";
import type { Auth } from "./auth";

/** Marks a request that is not user activity (WebSocket upgrade, ping): it does not bump the idle clock. */
export const BACKGROUND_HEADER = "x-background";

export interface AppIdentityService extends IdentityService {
  isSessionLive(sessionId: string): Promise<boolean>;
  /**
   * resolve() plus the user's must_change_password flag (D-A26), read in the same query. Principal
   * is a critical-tier contract, so the flag travels beside it. requireSession, the admin-prefix
   * middleware requirePasswordChanged (app.ts, ahead of adminGuard, which does not check it) and
   * the WebSocket upgrade refuse a principal whose flag is set (passwordChangeRequired).
   */
  resolveGated(req: Request): Promise<{ principal: Principal; mustChangePassword: boolean } | null>;
}

/**
 * The principal email goes into every audit row (actorOf). An address Better Auth accepts but
 * AuditActorSchema rejects (for example longer than 254 characters) would fail every audit write,
 * and so every submit, so it is stored as null instead.
 */
export function auditEmail(email: string): string | null {
  const r = AuditActorSchema.shape.email.safeParse(email);
  return r.success ? r.data : null;
}

/**
 * Session limits (spec 5.6, SEC-005): live while now - created_at < absolute, now - updated_at <
 * idle, and the user is not disabled. updated_at is the last user-initiated activity. `limits` is
 * read at each check, so a published config version applies to the next request (ADR-0011).
 */
export function createIdentityService(o: {
  db: Db;
  auth: Auth;
  limits: () => { absoluteMinutes: number; idleMinutes: number };
  clock: Clock;
  log: Logger;
}): AppIdentityService {
  async function load(sessionId: string) {
    const rows = await o.db
      .select({
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        stepUpAt: session.stepUpAt,
        userId: user.id,
        email: user.email,
        role: user.role,
        disabledAt: user.disabledAt,
        mustChangePassword: user.mustChangePassword,
      })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(eq(session.id, sessionId));
    return rows[0] ?? null;
  }
  type Row = NonNullable<Awaited<ReturnType<typeof load>>>;
  const live = (r: Row, now: number) => {
    const { absoluteMinutes, idleMinutes } = o.limits();
    return (
      r.disabledAt === null &&
      now - r.createdAt.getTime() < absoluteMinutes * 60_000 &&
      now - r.updatedAt.getTime() < idleMinutes * 60_000
    );
  };

  async function resolveGated(req: Request) {
    const s = await o.auth.api
      .getSession({ headers: req.headers, query: { disableRefresh: true } })
      .catch((e: unknown) => {
        // Fail closed, but leave a trace so an outage is not mistaken for an expired session.
        // Never log req.headers: they carry the session cookie (spec 5.9).
        o.log.warn("session resolution failed", {
          errorName: e instanceof Error ? e.name : typeof e,
          errorMessage: e instanceof Error ? e.message : undefined,
        });
        return null;
      });
    if (!s) return null;
    const row = await load(s.session.id);
    const now = o.clock.now();
    if (!row || !live(row, now)) return null;
    if (req.headers.get(BACKGROUND_HEADER) !== "1") {
      await o.db
        .update(session)
        .set({ updatedAt: new Date(now) })
        .where(eq(session.id, row.id));
    }
    const p: Principal = {
      userId: row.userId,
      email: auditEmail(row.email),
      role: row.role as Role,
      sessionId: row.id,
      identitySource: "local",
      authenticatedAt: row.createdAt.getTime(),
      ...(row.stepUpAt !== null ? { stepUpAt: row.stepUpAt } : {}),
    };
    return { principal: p, mustChangePassword: row.mustChangePassword };
  }

  return {
    resolveGated,
    async resolve(req) {
      return (await resolveGated(req))?.principal ?? null;
    },
    async isSessionLive(sessionId) {
      const row = await load(sessionId);
      return row !== null && live(row, o.clock.now());
    },
  };
}
