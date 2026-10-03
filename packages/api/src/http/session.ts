import type { MiddlewareHandler } from "hono";
import type { AppIdentityService } from "../auth/identity";
import { apiError } from "./errors";
import type { AppEnv } from "./types";

/**
 * Answers 401 unauthenticated unless the request resolves to a live session (SEC-005), and 403
 * passwordChangeRequired while the user still holds an admin-issued temporary password (D-A26):
 * only Better Auth's own routes (sign-in, sign-out, get-session, change-password), which do not
 * use this guard, stay open until it is changed.
 */
export const requireSession =
  (identity: AppIdentityService): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const r = await identity.resolveGated(c.req.raw);
    if (!r) return apiError(c, "unauthenticated");
    if (r.mustChangePassword) return apiError(c, "passwordChangeRequired");
    c.set("principal", r.principal);
    await next();
  };

/**
 * The same 403 passwordChangeRequired for a path whose own guard resolves the session itself
 * (the admin console, ADR-0011): a request with no live session passes through, so that guard
 * still answers 404, 401 or 403 in its own order. Mounted ahead of the admin routes in app.ts.
 * `applies` false (the route's feature is off, G-m1) passes through without resolving, so the
 * guard's 404 reaches every caller, a flagged one included (ADR-0011 item 6).
 */
export const requirePasswordChanged =
  (
    identity: AppIdentityService,
    applies: (path: string) => boolean = () => true,
  ): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    if (!applies(c.req.path)) return next();
    const r = await identity.resolveGated(c.req.raw);
    if (r?.mustChangePassword) return apiError(c, "passwordChangeRequired");
    await next();
  };
