import { AuditActorSchema, type Role } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import type { Clock } from "../clock";
import type { Db } from "../db/client";
import { session, user } from "../db/schema";
import type { IdentityService, Principal } from "../seams";
import type { Auth } from "./auth";

/** Marks a request that is not user activity (WebSocket upgrade, ping): it does not bump the idle clock. */
export const BACKGROUND_HEADER = "x-background";

export interface AppIdentityService extends IdentityService {
  isSessionLive(sessionId: string): Promise<boolean>;
}

/**
 * The principal email goes into every audit row (actorOf). An address Better Auth accepts but
 * AuditActorSchema rejects (for example longer than 254 characters) would fail every audit write,
 * and so every submit, so it is stored as null instead.
 */
function auditEmail(email: string): string | null {
  const r = AuditActorSchema.shape.email.safeParse(email);
  return r.success ? r.data : null;
}

/**
 * Session limits (spec 5.6, SEC-005): live while now - created_at < absolute, now - updated_at <
 * idle, and the user is not disabled. updated_at is the last user-initiated activity.
 */
export function createIdentityService(o: {
  db: Db;
  auth: Auth;
  limits: { absoluteMinutes: number; idleMinutes: number };
  clock: Clock;
}): AppIdentityService {
  const abs = o.limits.absoluteMinutes * 60_000;
  const idle = o.limits.idleMinutes * 60_000;
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
      })
      .from(session)
      .innerJoin(user, eq(session.userId, user.id))
      .where(eq(session.id, sessionId));
    return rows[0] ?? null;
  }
  type Row = NonNullable<Awaited<ReturnType<typeof load>>>;
  const live = (r: Row, now: number) =>
    r.disabledAt === null &&
    now - r.createdAt.getTime() < abs &&
    now - r.updatedAt.getTime() < idle;

  return {
    async resolve(req) {
      const s = await o.auth.api
        .getSession({ headers: req.headers, query: { disableRefresh: true } })
        .catch(() => null);
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
      return p;
    },
    async isSessionLive(sessionId) {
      const row = await load(sessionId);
      return row !== null && live(row, o.clock.now());
    },
  };
}
