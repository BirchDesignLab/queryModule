import type { FeatureKey } from "@querymodule/core/config";
import type { Role } from "@querymodule/core/contracts";
import type { MiddlewareHandler } from "hono";
import type { AppDeps } from "../deps";
import { apiError } from "../http/errors";
import type { AppEnv } from "../http/types";

/** RouteAccess configEditor (ADR-0011 item 6): admin, and implementer for config only. */
export const CONFIG_EDITOR_ROLES: readonly Role[] = ["admin", "implementer"];

/**
 * The admin console guard (ADR-0011 item 6), in this order: the feature off answers
 * 404 notFound to every caller (the route does not exist for the site), a user who still holds a
 * temporary password included; no live session 401 unauthenticated (as requireSession); a user
 * who still holds a temporary password 403 passwordChangeRequired (D-A26), whatever the role; a
 * role outside `roles` 403 forbidden. The feature is read from the live snapshot once per
 * request, so a publish that turns it off applies at once, and the session is resolved once.
 */
export function adminGuard(
  d: AppDeps,
  feature: FeatureKey,
  roles: readonly Role[],
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (d.config.current().siteConfig.features[feature] !== true) return apiError(c, "notFound");
    const r = await d.identity.resolveGated(c.req.raw);
    if (!r) return apiError(c, "unauthenticated");
    if (r.mustChangePassword) return apiError(c, "passwordChangeRequired");
    const p = r.principal;
    c.set("principal", p);
    if (!roles.includes(p.role)) return apiError(c, "forbidden");
    await next();
  };
}
