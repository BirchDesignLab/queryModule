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

/** The session cookie's attributes: Better Auth's config and the app's own clear share them. */
const SESSION_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

/**
 * The Set-Cookie line that clears the session cookie, byte-identical to Better Auth's own clear
 * (#339 G-G-m1; sign-out.test.ts pins the parity). Used when the app clears it itself.
 */
export function clearSessionCookie(env: DeployEnv): string {
  return `${sessionCookieName(env)}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
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
  if (a === null || typeof a !== "object") return a;
  // Only an Error (or an error-shaped object: a string name plus a string message or stack)
  // reduces to its name. Any other object with a string `name`, such as a Better Auth user
  // record, would put a person's display name in a log line (spec 5.9, GDPR; wave review
  // G-G-m2), so it reduces to its typeof like every other object.
  const o = a as { name?: unknown; message?: unknown; stack?: unknown };
  const errorShaped =
    a instanceof Error ||
    (typeof o.name === "string" && (typeof o.message === "string" || typeof o.stack === "string"));
  if (errorShaped && typeof o.name === "string") return { errorName: o.name };
  return typeof a;
}

/**
 * Better Auth 1.7.6 (dist/api/index.mjs:206-208) logs `ctx.logger.error(e.message)` for an
 * uncaught error whose message mentions a column, table or relation. A DrizzleQueryError message
 * ("Failed query: <sql>\nparams: <values>") would then arrive as a plain string carrying query
 * params (user id, email, session token), past the fixed `secretValues` scrub. Such a message is
 * replaced with a fixed text (spec 5.9; wave review G-G-m1).
 */
function toBetterAuthLoggerMessage(message: string): string {
  return message.includes("Failed query") || message.includes("\nparams:")
    ? "database error"
    : message;
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
 *
 * Better Auth's own call sites are not consistent about what they pass as `message`: most pass a
 * string, but some (`better-auth` dist `api/routes/session.mjs:370`, the `/list-sessions`
 * endpoint's `catch (e) { ctx.context.logger.error(e); }`) pass the raw `Error` itself as the
 * sole/`message` argument, with no extra `args` at all (re-review r1:CV1-message-gap). The app
 * logger's `serialise()` only scrubs `head` (the `message` string) against the fixed
 * `secretValues` list via `String.prototype.split`, which throws a `TypeError` when `message` is
 * not a string (an object has no `.split`). So an unmapped `message` here would either throw, or
 * (if it happened to stringify) carry a Drizzle adapter error's free-text query and params
 * (session tokens, user ids, emails) straight past `secretValues`. `message` is reduced through
 * the same `toBetterAuthLoggerArg` rule as every other arg before it is ever handed to the app
 * logger, so it is always a string by the time it reaches `log[appLevel]`.
 */
export function toBetterAuthLogger(log: Logger) {
  return {
    log(
      level: "debug" | "info" | "success" | "warn" | "error",
      message: unknown,
      ...args: unknown[]
    ) {
      const appLevel = level === "success" ? "info" : level;
      const mapped = args.map(toBetterAuthLoggerArg);
      const msg =
        typeof message === "string"
          ? toBetterAuthLoggerMessage(message)
          : (() => {
              const reduced = toBetterAuthLoggerArg(message);
              return reduced !== null && typeof reduced === "object" && "errorName" in reduced
                ? (reduced as { errorName: string }).errorName
                : typeof message;
            })();
      log[appLevel](msg, { args: mapped });
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
          attributes: SESSION_COOKIE_ATTRIBUTES,
        },
      },
      database: { generateId: () => uuidv7() },
      ipAddress: { disableIpTracking: true },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;
