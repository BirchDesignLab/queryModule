import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { DeployEnv } from "../env";
import { uuidv7 } from "../ids";
import { apiError } from "./errors";
import type { AppEnv } from "./types";

export const REQUESTED_WITH = "querymodule";
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const requestId = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  c.set("requestId", uuidv7());
  await next();
};

export const securityHeaders = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Strict-Transport-Security", "max-age=31536000");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
};

export const noStore = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
};

// Better Auth routes rely on its own origin check (spec 5.9) and are exempt, except two:
// /auth/embedded is not Better Auth, and sign-out (#289) deletes the session in the app's own
// transaction before Better Auth runs, so Better Auth's origin check no longer guards that
// delete and the app's header check must. Both checks ignore case and cover a trailing slash or
// sub-path, so no routing option (strict: false, case-insensitive matching) can reach either
// handler without the header.
const GUARDED_AUTH_PATHS = ["/api/v1/auth/embedded", "/api/v1/auth/sign-out"];
const isBetterAuthPath = (p: string) => {
  if (!p.startsWith("/api/v1/auth/")) return false;
  const lower = p.toLowerCase();
  return !GUARDED_AUTH_PATHS.some((g) => lower === g || lower.startsWith(`${g}/`));
};

export const requireRequestedWith = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (
    STATE_CHANGING.has(c.req.method) &&
    !isBetterAuthPath(c.req.path) &&
    c.req.header("x-requested-with") !== REQUESTED_WITH
  ) {
    return apiError(c, "forbidden");
  }
  await next();
};

export const bodyCap = (): MiddlewareHandler<AppEnv> =>
  bodyLimit({ maxSize: 32 * 1024, onError: (c) => apiError(c as never, "payloadTooLarge") });

export function buildCsp(env: DeployEnv, nonce: string): string {
  const ws = env.publicOrigin.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    `connect-src 'self' ${ws}`,
    "img-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
