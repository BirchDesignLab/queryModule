import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import type { Db } from "../db/client";
import { authSchema } from "../db/schema";
import type { DeployEnv } from "../env";
import { uuidv7 } from "../ids";
import type { Logger } from "../log/logger";

/**
 * bearer()'s own `after` hook (better-auth/dist/plugins/bearer/index.mjs) always copies the
 * session cookie into a JS-readable `set-auth-token` header and exposes it via
 * `Access-Control-Expose-Headers` on every sign-in, regardless of Origin. That defeats the
 * httpOnly cookie for a web browser (spec 5.6): a stolen token can be replayed as
 * `Authorization: Bearer` from anywhere. Native clients (Expo) authenticate through the Expo
 * plugin, not this header, so nothing needs it when a request carries an Origin header (only a
 * browser sends Origin). This plugin's own `after` hook runs after bearer's in the same
 * `hooks.after` pass (plugin hooks run in `plugins` array order, see
 * better-auth/dist/api/dispatch.mjs `getHooks`), so it can strip what bearer just set.
 */
const stripWebBearerToken = {
  id: "strip-web-bearer-token",
  hooks: {
    after: [
      {
        matcher: (ctx: { request?: Request; headers?: Headers }) =>
          Boolean(ctx.request?.headers.get("origin") ?? ctx.headers?.get("origin")),
        handler: createAuthMiddleware(async (ctx) => {
          const headers = ctx.context.responseHeaders;
          if (!headers?.has("set-auth-token")) return;
          headers.delete("set-auth-token");
          const exposed = headers.get("access-control-expose-headers");
          if (!exposed) return;
          const remaining = exposed
            .split(",")
            .map((h) => h.trim())
            .filter((h) => h.length > 0 && h.toLowerCase() !== "set-auth-token");
          if (remaining.length > 0)
            headers.set("access-control-expose-headers", remaining.join(", "));
          else headers.delete("access-control-expose-headers");
        }),
      },
    ],
  },
};

/**
 * The session cookie name (spec 5.6). `__Host-` requires Secure, `Path=/` and no `Domain`
 * attribute, which a plain HTTP localhost dev server cannot satisfy, so development uses the
 * unprefixed name instead.
 */
export function sessionCookieName(env: DeployEnv): "__Host-qm_session" | "qm_session" {
  return env.nodeEnv === "development" ? "qm_session" : "__Host-qm_session";
}

/**
 * Better Auth's own telemetry gate is `getBooleanEnvVar("BETTER_AUTH_TELEMETRY", false) ||
 * options.telemetry.enabled` (@better-auth/telemetry/dist/index.mjs `isEnabled`): the env var
 * can turn telemetry on even though `options.telemetry.enabled` is `false` here, and the
 * anonymous init/session events it would then post go to an external endpoint this prototype
 * must never reach. Mirrors `getBooleanEnvVar`'s truthiness (unset, "0" and "false" are off).
 */
function isTelemetryEnvTruthy(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  return value !== "0" && value.toLowerCase() !== "false";
}

/**
 * Better Auth's own `ctx.context.logger.error(e.status, e)` / `ctx.logger.error(...)` calls
 * (`better-auth/dist/api/index.mjs`, `.../routes/session.mjs`) pass the raw error object as an
 * arg. For an adapter failure that error's `message` can be a Drizzle query error such as
 * `"Failed query: insert ... params: <values>"`, which can hold a session token, user id or
 * email that is not in the app logger's fixed `secretValues` list and is not under a redacted
 * key (critic finding CV1, this task). The app logger's field walk only scrubs known secret
 * values and known key names, so free text inside an Error's `message` would otherwise reach
 * the sink verbatim. Reducing every Error-like arg to `{ errorName }` before it is logged drops
 * that free text entirely rather than trying to pattern-match what might be inside it.
 */
function toBetterAuthLoggerArg(a: unknown): unknown {
  if (
    a !== null &&
    typeof a === "object" &&
    "name" in a &&
    typeof (a as { name?: unknown }).name === "string"
  ) {
    return { errorName: (a as { name: string }).name };
  }
  if (a === null || typeof a !== "object") return a;
  return typeof a;
}

/**
 * Better Auth's own logger option (`@better-auth/core/env` `createLogger`) takes
 * `{ log?(level, message, ...args) }`, where level is "debug" | "info" | "success" | "warn" |
 * "error"; with no `log` function it writes straight to `console.*`, unredacted. Routing it
 * through the app's redacting logger (packages/api/src/log/logger.ts, A3 T14 ruling CV2) keeps
 * every Better Auth line (secret-length and entropy warnings, misconfiguration errors) inside
 * the same scrub-and-redact path as everything else (SEC-006). Exported so the log-capture test
 * can drive it directly: Better Auth's own default log level ("warn") means the scenarios this
 * test exercises never happen to emit a warn/error line on their own (critic finding C1/S1), so
 * the redaction and arg-mapping behaviour needs a direct call to be observable at all.
 */
export function toBetterAuthLogger(log: Logger) {
  return {
    log(
      level: "debug" | "info" | "success" | "warn" | "error",
      message: string,
      ...args: unknown[]
    ) {
      const appLevel = level === "success" ? "info" : level;
      const mapped = args.map(toBetterAuthLoggerArg);
      log[appLevel](message, { args: mapped });
    },
  };
}

export function createAuth(o: {
  db: Db;
  env: DeployEnv;
  secret: string;
  session: { absoluteMinutes: number; idleMinutes: number };
  log?: Logger;
}) {
  if (isTelemetryEnvTruthy(process.env.BETTER_AUTH_TELEMETRY)) {
    throw new Error(
      "BETTER_AUTH_TELEMETRY is set: refusing to start. This prototype never sends telemetry " +
        "to an external endpoint (plan Task 6 amendment); unset BETTER_AUTH_TELEMETRY.",
    );
  }
  return betterAuth({
    appName: "Query Module",
    baseURL: o.env.publicOrigin,
    basePath: "/api/v1/auth",
    ...(o.log ? { logger: toBetterAuthLogger(o.log) } : {}),
    secret: o.secret,
    trustedOrigins: o.env.corsOrigins,
    // transaction: false pinned explicitly (plan Task 6 amendment): the sqlite provider path
    // never opens a drizzle transaction of its own regardless (that codepath only runs for
    // `provider: "mysql"`, or here if this option were left to default-flip on), but
    // withTransaction (packages/api/src/db/**, critical tier) must be the only place that does.
    database: drizzleAdapter(o.db, { provider: "sqlite", schema: authSchema, transaction: false }),
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
    // bearer(): a missing-Origin socket with Authorization: Bearer can still authenticate (spec
    // 5.3). requireSignature: true rejects a raw, unsigned session token presented as a bearer
    // token (SEC-005); stripWebBearerToken must come after bearer() in this array so its
    // `hooks.after` runs after bearer's and can remove what bearer just set (see above).
    plugins: [bearer({ requireSignature: true }), stripWebBearerToken],
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
