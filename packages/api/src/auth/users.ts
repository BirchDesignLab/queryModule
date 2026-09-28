import type { Auth } from "./auth";

// Public sign-up is disabled; demo users are created here by seed.ts (spec 8.5). Role changes go through grantRole.
export async function createLocalUser(
  auth: Auth,
  o: { email: string; name: string; password: string },
): Promise<{ id: string }> {
  const ctx = await auth.$context;
  const email = o.email.trim().toLowerCase();
  const hash = await ctx.password.hash(o.password);
  // "admin": these accounts are provisioned by seed.ts, not created through the (disabled)
  // self-serve email-password sign-up endpoint (installed better-auth@1.7.6 requires a
  // UserProvisioningSource; the brief's snippet predates that second createUser argument).
  const user = await ctx.internalAdapter.createUser(
    { email, name: o.name, emailVerified: true },
    { method: "admin" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });
  return { id: user.id };
}
