import type { Role } from "@querymodule/core/contracts";
import { count } from "drizzle-orm";
import { createLocalUser } from "../auth/users";
import { user } from "../db/schema";
import type { AppDeps } from "../deps";
import { grantRole } from "../ops/grant-role";
import { derivePassword } from "./password";
import { DEMO_USERS } from "./users";

export class SeedRefusedError extends Error {
  constructor() {
    super("seed runs only against an empty database");
    this.name = "SeedRefusedError";
  }
}

/**
 * Thrown when seedUsers fails part-way through DEMO_USERS. `created` lists every demo user whose
 * row already exists (in order, with its derived password) so the caller can recover: a rerun
 * throws SeedRefusedError once any user exists (spec 8.5's run-once contract is never relaxed),
 * so the operator needs this list to know who was made and to finish role grants by hand via
 * `scripts/ops/grant-role.ts` (see docs/demo.md's Recovery section). The message never repeats a
 * password (spec 5.9); only the CLI's own stdout may do that.
 */
export class SeedPartialFailureError extends Error {
  readonly created: { email: string; role: Role; password: string }[];
  readonly seedCause: unknown;
  constructor(created: { email: string; role: Role; password: string }[], cause: unknown) {
    const emails = created.map((u) => u.email).join(", ") || "none";
    super(
      `seed failed after creating ${created.length}/${DEMO_USERS.length} demo users (${emails}); ` +
        "rerun is refused until the database is repaired or reset (see docs/demo.md#recovery)",
    );
    this.name = "SeedPartialFailureError";
    this.created = created;
    this.seedCause = cause;
  }
}

/** Spec 8.5: runs once against an empty database; passwords print only on the caller's stdout. */
export async function seedUsers(
  d: AppDeps,
  secret: string,
): Promise<{ email: string; role: Role; password: string }[]> {
  const n = (await d.db.select({ n: count() }).from(user))[0]?.n ?? 0;
  if (n > 0) throw new SeedRefusedError();
  const created: { email: string; role: Role; password: string }[] = [];
  for (const u of DEMO_USERS) {
    const password = derivePassword(secret, u.email);
    try {
      await createLocalUser(d.auth, { email: u.email, name: u.name, password });
    } catch (e) {
      throw new SeedPartialFailureError(created, e);
    }
    // The user row now exists (with this password) regardless of whether the role grant below
    // succeeds, so it belongs in the recovery list from this point on.
    created.push({ email: u.email, role: u.role, password });
    if (u.role !== "user") {
      try {
        await grantRole(d, { email: u.email, role: u.role, change: "granted" });
      } catch (e) {
        throw new SeedPartialFailureError(created, e);
      }
    }
  }
  return created;
}
