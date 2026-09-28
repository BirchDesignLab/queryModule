import type { MiddlewareHandler } from "hono";
import type { IdentityService } from "../seams";
import { apiError } from "./errors";
import type { AppEnv } from "./types";

/** Answers 401 unauthenticated unless the request resolves to a live session (SEC-005). */
export const requireSession =
  (identity: IdentityService): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const p = await identity.resolve(c.req.raw);
    if (!p) return apiError(c, "unauthenticated");
    c.set("principal", p);
    await next();
  };
