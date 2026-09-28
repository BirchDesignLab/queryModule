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

/** Spec 8.5: runs once against an empty database; passwords print only on the caller's stdout. */
export async function seedUsers(
  d: AppDeps,
  secret: string,
): Promise<{ email: string; role: Role; password: string }[]> {
  const n = (await d.db.select({ n: count() }).from(user))[0]?.n ?? 0;
  if (n > 0) throw new SeedRefusedError();
  const out: { email: string; role: Role; password: string }[] = [];
  for (const u of DEMO_USERS) {
    const password = derivePassword(secret, u.email);
    await createLocalUser(d.auth, { email: u.email, name: u.name, password });
    if (u.role !== "user") await grantRole(d, { email: u.email, role: u.role, change: "granted" });
    out.push({ email: u.email, role: u.role, password });
  }
  return out;
}
