import { randomBytes } from "node:crypto";
import type {
  AdminUser,
  AdminUserSessionSchema,
  CreateUserBodySchema,
  Role,
} from "@querymodule/core/contracts";
import { and, desc, eq, gt } from "drizzle-orm";
import type { z } from "zod";
import { account, session, user } from "../../db/schema";
import { withTransaction } from "../../db/tx";
import type { AppDeps } from "../../deps";
import { uuidv7 } from "../../ids";
import { loginStatsByUser, type UserSignInStats } from "../../ops/login-stats";
import { actorOf, type Principal } from "../../seams";

/*
 * User administration (ADR-0011 item 8, D-A26, SEC-005, SEC-010, SEC-014). Each change runs in
 * one transaction with its audit row (AuditService through the same tx); the sessions a change
 * ends are closed through the EventBus only after it commits. Nothing here logs: no password,
 * hash, token, address or IP value reaches a log line or a response (spec 5.9).
 */

type UserRow = typeof user.$inferSelect;
type AdminUserSessionRow = z.infer<typeof AdminUserSessionSchema>;
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;

const NO_SIGN_INS: UserSignInStats = { signIns: 0, distinctIps: 0, lastSignIn: null };

export function toAdminUser(row: UserRow, stats: UserSignInStats = NO_SIGN_INS): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: row.disabledAt !== null,
    mustChangePassword: row.mustChangePassword,
    createdAt: row.createdAt.getTime(),
    signInCount: stats.signIns,
    lastSignInAt: stats.lastSignIn,
    distinctIps: stats.distinctIps,
  };
}

async function statsOf(d: AppDeps, id: string): Promise<UserSignInStats | undefined> {
  return (await loginStatsByUser(d.db, id)).get(id);
}

export async function listUsers(d: AppDeps): Promise<AdminUser[]> {
  const rows = await d.db.select().from(user).orderBy(user.email).limit(1000);
  const stats = await loginStatsByUser(d.db);
  return rows.map((r) => toAdminUser(r, stats.get(r.id)));
}

/** 24 URL-safe characters from 18 random bytes (144 bits): within the contract's 16 to 128. */
function temporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

export type CreateResult =
  | { ok: true; user: AdminUser; temporaryPassword: string }
  | { ok: false; code: "emailTaken" };

/**
 * Creates the user and its credential account with a server-generated one-time password, set
 * to be changed at first sign-in (D-A26), and writes userCreated, in one transaction. The
 * password is hashed with Better Auth's own hasher and returned to the caller once.
 */
export async function createUser(
  d: AppDeps,
  actor: Principal,
  body: CreateUserBody,
): Promise<CreateResult> {
  const email = body.email.trim().toLowerCase();
  const password = temporaryPassword();
  const hash = await (await d.auth.$context).password.hash(password);
  const now = new Date(d.clock.now());
  const id = uuidv7();
  const row = await withTransaction(d.db, async (tx): Promise<UserRow | null> => {
    const taken = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (taken.length > 0) return null;
    const [created] = await tx
      .insert(user)
      .values({
        id,
        email,
        name: body.name,
        emailVerified: true,
        role: body.role,
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(account).values({
      id: uuidv7(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: hash,
      createdAt: now,
      updatedAt: now,
    });
    await d.audit.record(tx, {
      type: "userCreated",
      actor: actorOf(actor),
      identitySource: actor.identitySource,
      details: { targetUserId: id, role: body.role },
    });
    return created ?? null;
  });
  if (!row) return { ok: false, code: "emailTaken" };
  return { ok: true, user: toAdminUser(row), temporaryPassword: password };
}

export type DisableResult =
  | { ok: true; user: AdminUser; sessionsRevoked: number }
  | { ok: false; code: "notFound" | "lastAdmin" };

/**
 * One transaction: set disabledAt, delete the user's sessions, write userDisabled with the
 * counts (M1 has no delegations or state credentials, so those are 0; the credential purge
 * lands in credentials/** with M3 P1). The sockets of the ended sessions close after commit.
 * An admin cannot disable themselves, which also keeps an enabled admin: the caller. Disabling
 * an already disabled user is a no-op with no audit row.
 */
export async function disableUser(
  d: AppDeps,
  actor: Principal,
  id: string,
): Promise<DisableResult> {
  if (id === actor.userId) return { ok: false, code: "lastAdmin" };
  const done = await withTransaction(d.db, async (tx) => {
    const target = (await tx.select().from(user).where(eq(user.id, id)))[0];
    if (!target) return null;
    if (target.disabledAt !== null) return { target, sessionIds: [] as string[] };
    const sessionIds = (
      await tx.select({ id: session.id }).from(session).where(eq(session.userId, id))
    ).map((s) => s.id);
    const now = d.clock.now();
    await tx
      .update(user)
      .set({ disabledAt: now, updatedAt: new Date(now) })
      .where(eq(user.id, id));
    await tx.delete(session).where(eq(session.userId, id));
    await d.audit.record(tx, {
      type: "userDisabled",
      actor: actorOf(actor),
      identitySource: actor.identitySource,
      details: {
        targetUserId: id,
        sessionsRevoked: sessionIds.length,
        delegationsRevoked: 0,
        credentialsDeleted: 0,
      },
    });
    return { target: { ...target, disabledAt: now }, sessionIds };
  });
  if (!done) return { ok: false, code: "notFound" };
  for (const sid of done.sessionIds) d.eventBus.endSession(sid);
  return {
    ok: true,
    user: toAdminUser(done.target, await statsOf(d, id)),
    sessionsRevoked: done.sessionIds.length,
  };
}

export type RoleResult =
  | { ok: true; user: AdminUser }
  | { ok: false; code: "notFound" | "lastAdmin" };

/**
 * Sets the role and writes roleChanged via adminConsole, in one transaction. A move to user is
 * recorded as the revoke of the role held (as grant-role does); anything else as a grant of the
 * new role. An admin cannot change their own role. The same role is a no-op with no audit row.
 */
export async function setUserRole(
  d: AppDeps,
  actor: Principal,
  id: string,
  role: Role,
): Promise<RoleResult> {
  if (id === actor.userId) return { ok: false, code: "lastAdmin" };
  const changed = await withTransaction(d.db, async (tx) => {
    const target = (await tx.select().from(user).where(eq(user.id, id)))[0];
    if (!target) return null;
    if (target.role === role) return target;
    await tx
      .update(user)
      .set({ role, updatedAt: new Date(d.clock.now()) })
      .where(eq(user.id, id));
    await d.audit.record(tx, {
      type: "roleChanged",
      actor: actorOf(actor),
      identitySource: actor.identitySource,
      details: {
        targetUserId: id,
        role: role === "user" ? target.role : role,
        change: role === "user" ? "revoked" : "granted",
        via: "adminConsole",
      },
    });
    return { ...target, role };
  });
  if (!changed) return { ok: false, code: "notFound" };
  return { ok: true, user: toAdminUser(changed, await statsOf(d, id)) };
}

/** A user's live sessions (not past their absolute expiry), newest first; null if no such user. */
export async function listUserSessions(
  d: AppDeps,
  actor: Principal,
  id: string,
): Promise<AdminUserSessionRow[] | null> {
  const exists = await d.db.select({ id: user.id }).from(user).where(eq(user.id, id));
  if (exists.length === 0) return null;
  const rows = await d.db
    .select({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      userAgent: session.userAgent,
    })
    .from(session)
    .where(and(eq(session.userId, id), gt(session.expiresAt, new Date(d.clock.now()))))
    .orderBy(desc(session.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.getTime(),
    expiresAt: r.expiresAt.getTime(),
    userAgent: r.userAgent === null ? null : r.userAgent.slice(0, 256),
    current: r.id === actor.sessionId,
  }));
}

/** Deletes one session and writes sessionRevoked reason admin in one transaction, then ends it. */
export async function revokeSession(
  d: AppDeps,
  actor: Principal,
  sessionId: string,
): Promise<boolean> {
  const gone = await withTransaction(d.db, async (tx) => {
    const deleted = await tx
      .delete(session)
      .where(eq(session.id, sessionId))
      .returning({ id: session.id });
    if (deleted.length === 0) return false;
    await d.audit.record(tx, {
      type: "sessionRevoked",
      actor: actorOf(actor),
      identitySource: actor.identitySource,
      details: { sessionId, reason: "admin" },
    });
    return true;
  });
  if (gone) d.eventBus.endSession(sessionId);
  return gone;
}
