import { type Role, SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { eq } from "drizzle-orm";
import { account, user, userPreference } from "../db/schema";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { uuidv7 } from "../ids";
import { derivePassword } from "../seed/password";
import { DEMO_USERS } from "../seed/users";
import { grantRole } from "./grant-role";

type DemoUser = (typeof DEMO_USERS)[number];

export class AddDemoUsersUsageError extends Error {
  constructor() {
    super("usage: add-demo-users (no arguments)");
    this.name = "AddDemoUsersUsageError";
  }
}

/** CLI arguments of scripts/ops/add-demo-users.ts: none; the account list is DEMO_USERS. */
export function parseAddDemoUsersArgs(argv: readonly string[]): void {
  if (argv.length > 0) throw new AddDemoUsersUsageError();
}

export class AddDemoUsersDomainError extends Error {
  constructor() {
    super("add-demo-users creates @example.test accounts only");
    this.name = "AddDemoUsersDomainError";
  }
}

/**
 * Thrown when a role grant fails after its account was created (#781). `created` keeps every
 * account made so far, with its derived password, for the CLI's stdout only; the message never
 * repeats a password (spec 5.9). A rerun skips the account (it exists), so the operator finishes
 * the grant by hand with scripts/ops/grant-role.ts.
 */
export class AddDemoUsersPartialFailureError extends Error {
  readonly created: { email: string; role: Role; password: string }[];
  constructor(created: { email: string; role: Role; password: string }[], email: string) {
    super(
      `role grant failed for ${email} after its account was created; ` +
        "finish it with scripts/ops/grant-role.ts (see docs/demo.md#recovery)",
    );
    this.name = "AddDemoUsersPartialFailureError";
    this.created = created;
  }
}

/**
 * #781: adds the DEMO_USERS a database lacks, for a live demo that is never reset (the seed runs
 * once only, spec 8.5). An existing account is skipped whole: its password, role, preferences and
 * state stay as they are. Each new account is one transaction: user (role user, no forced
 * password change), credential with the derived password, persona preference, and userCreated by
 * SYSTEM_ACTOR via add-demo-users. A non-user role is then granted through grantRole, which writes
 * roleChanged via grant-role as the seed does. Nothing here logs; passwords go back to the caller.
 */
export async function addMissingDemoUsers(
  d: Pick<AppDeps, "db" | "audit" | "clock" | "auth">,
  secret: string,
  users: readonly DemoUser[] = DEMO_USERS,
): Promise<{ created: { email: string; role: Role; password: string }[]; existing: string[] }> {
  if (users.some((u) => !u.email.trim().toLowerCase().endsWith("@example.test")))
    throw new AddDemoUsersDomainError();
  const ctx = await d.auth.$context;
  const created: { email: string; role: Role; password: string }[] = [];
  const existing: string[] = [];
  for (const u of users) {
    const email = u.email.trim().toLowerCase();
    const password = derivePassword(secret, email);
    const hash = await ctx.password.hash(password);
    const now = new Date(d.clock.now());
    const id = uuidv7();
    const made = await withTransaction(d.db, async (tx) => {
      const taken = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (taken.length > 0) return false;
      await tx.insert(user).values({
        id,
        email,
        name: u.name,
        emailVerified: true,
        role: "user",
        mustChangePassword: false,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(account).values({
        id: uuidv7(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: hash,
        createdAt: now,
        updatedAt: now,
      });
      if (u.persona !== undefined)
        await tx
          .insert(userPreference)
          .values({ userId: id, personaOverride: u.persona, updatedAt: now });
      await d.audit.record(tx, {
        type: "userCreated",
        actor: SYSTEM_ACTOR,
        identitySource: "system",
        details: { targetUserId: id, role: "user", via: "add-demo-users" },
      });
      return true;
    });
    if (!made) {
      existing.push(email);
      continue;
    }
    created.push({ email, role: u.role, password });
    if (u.role !== "user") {
      try {
        await grantRole(d, { email, role: u.role, change: "granted" });
      } catch {
        throw new AddDemoUsersPartialFailureError(created, email);
      }
    }
  }
  return { created, existing };
}
