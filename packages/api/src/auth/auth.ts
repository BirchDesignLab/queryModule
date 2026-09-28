import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { Db } from "../db/client";
import { authSchema } from "../db/schema";
import type { DeployEnv } from "../env";
import { uuidv7 } from "../ids";

/**
 * The session cookie name (spec 5.6). `__Host-` requires Secure, `Path=/` and no `Domain`
 * attribute, which a plain HTTP localhost dev server cannot satisfy, so development uses the
 * unprefixed name instead.
 */
export function sessionCookieName(env: DeployEnv): "__Host-qm_session" | "qm_session" {
  return env.nodeEnv === "development" ? "qm_session" : "__Host-qm_session";
}

export function createAuth(o: {
  db: Db;
  env: DeployEnv;
  secret: string;
  session: { absoluteMinutes: number; idleMinutes: number };
}) {
  return betterAuth({
    appName: "Query Module",
    baseURL: o.env.publicOrigin,
    basePath: "/api/v1/auth",
    secret: o.secret,
    trustedOrigins: o.env.corsOrigins,
    database: drizzleAdapter(o.db, { provider: "sqlite", schema: authSchema }),
    // Public sign-up disabled (spec 5.6): demo users come from seed.ts, not this endpoint.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    session: {
      // The idle clock is ours (Task 15); Better Auth only enforces the absolute limit.
      expiresIn: o.session.absoluteMinutes * 60,
      disableSessionRefresh: true,
      // Cookie cache off so a revoked session is rejected immediately, not after its cache TTL.
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "user", input: false },
        identitySource: { type: "string", defaultValue: "local", input: false },
      },
    },
    // Better Auth's own rate limiter off; ours is Task 16.
    rateLimit: { enabled: false },
    // Disabled explicitly (plan Task 6 amendment): no anonymous usage data leaves this
    // prototype, which never connects to a real network of state or national systems.
    telemetry: { enabled: false },
    // bearer(): a missing-Origin socket with Authorization: Bearer can still authenticate (spec 5.3).
    plugins: [bearer()],
    advanced: {
      useSecureCookies: false,
      cookies: {
        session_token: {
          name: sessionCookieName(o.env),
          attributes: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
        },
      },
      database: { generateId: () => uuidv7() },
      ipAddress: { disableIpTracking: true },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;
