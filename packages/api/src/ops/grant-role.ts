import { ROLES, type Role, SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import { user } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";

export type { Role } from "@querymodule/core/contracts";
// Re-exported so ops scripts import only from packages/api (esbuild resolves @querymodule/core from there, not from scripts/).
export { ROLES } from "@querymodule/core/contracts";

export class GrantRoleUsageError extends Error {
  constructor() {
    super(`usage: grant-role <email> <${ROLES.join("|")}> [--revoke]`);
    this.name = "GrantRoleUsageError";
  }
}

/** CLI arguments of scripts/ops/grant-role.ts: exactly an email and a role, plus an optional --revoke. */
export function parseGrantRoleArgs(argv: readonly string[]): {
  email: string;
  role: Role;
  change: "granted" | "revoked";
} {
  const revoke = argv.includes("--revoke");
  const rest = argv.filter((a) => a !== "--revoke");
  const [email, role] = rest;
  if (
    rest.length !== 2 ||
    !email ||
    email.startsWith("-") ||
    !(ROLES as readonly string[]).includes(role ?? "")
  )
    throw new GrantRoleUsageError();
  return { email, role: role as Role, change: revoke ? "revoked" : "granted" };
}

export class UnknownUserError extends Error {
  constructor() {
    super("no user with that email");
    this.name = "UnknownUserError";
  }
}

/**
 * Roles change only here; there is no role-editing route (spec 5.6). One transaction updates
 * user.role and writes roleChanged (system actor); an audit failure rolls the role back. A
 * revoke sets the role back to "user". IdentityService reads role from the user row, so the
 * new role applies on the user's next request.
 */
export function grantRole(
  d: Pick<AppDeps, "db" | "audit" | "clock">,
  o: { email: string; role: Role; change: "granted" | "revoked" },
): Promise<{ userId: string; role: Role; changed: boolean }> {
  return withTransaction(d.db, async (tx) => {
    const u = (await tx.select().from(user).where(eq(user.email, o.email.trim().toLowerCase())))[0];
    if (!u) throw new UnknownUserError();
    if (o.change === "granted" && o.role === "user")
      throw new Error("granting user is a demotion: revoke the held role instead");
    // A no-op (grant of a held role, revoke from a user-role user) writes and audits nothing,
    // so callers such as the demo-user seed can re-run (#217).
    if (o.change === "granted" && u.role === o.role)
      return { userId: u.id, role: u.role, changed: false };
    if (o.change === "revoked" && u.role === "user")
      return { userId: u.id, role: u.role, changed: false };
    if (o.change === "revoked" && u.role !== o.role)
      throw new Error(`user does not hold ${o.role}`);
    const next: Role = o.change === "granted" ? o.role : "user";
    await tx
      .update(user)
      .set({ role: next, updatedAt: new Date(d.clock.now()) })
      .where(eq(user.id, u.id));
    await d.audit.record(tx, {
      type: "roleChanged",
      actor: SYSTEM_ACTOR,
      identitySource: "system",
      details: { targetUserId: u.id, role: o.role, change: o.change, via: "grant-role" },
    });
    return { userId: u.id, role: next, changed: true };
  });
}
