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
