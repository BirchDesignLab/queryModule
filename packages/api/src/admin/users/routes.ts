import {
  AdminUserListSchema,
  AdminUserSchema,
  AdminUserSessionListSchema,
  CreateUserBodySchema,
  CreateUserResponseSchema,
  DisableUserResponseSchema,
  SessionParamsSchema,
  SetRoleBodySchema,
  UserParamsSchema,
} from "@querymodule/core/contracts";
import type { Context, Hono } from "hono";
import type { z } from "zod";
import type { AppDeps } from "../../deps";
import { apiError } from "../../http/errors";
import type { AppEnv } from "../../http/types";
import { adminGuard } from "../access";
import {
  createUser,
  disableUser,
  listUserSessions,
  listUsers,
  revokeSession,
  setUserRole,
} from "./users";

const BASE = "/api/v1/admin/users";

async function bodyOf<T extends z.ZodType>(c: Context<AppEnv>, schema: T) {
  return schema.safeParse(await c.req.json().catch(() => undefined));
}

/**
 * The admin user routes (ADR-0011 item 8; contracts in core admin.ts and routes.ts): admin only,
 * behind the adminUsers feature. Responses carry no password, hash, token or IP value, and the
 * one-time password appears only in the create response (ADR-0011 item 8, D-A26; spec 5.9).
 */
export function mountAdminUserRoutes(app: Hono<AppEnv>, d: AppDeps): void {
  const guard = adminGuard(d, "adminUsers", ["admin"]);

  app.get(BASE, guard, async (c) =>
    c.json(AdminUserListSchema.parse({ users: await listUsers(d) })),
  );

  app.post(BASE, guard, async (c) => {
    const body = await bodyOf(c, CreateUserBodySchema);
    if (!body.success) return apiError(c, "validationFailed");
    const r = await createUser(d, c.get("principal"), body.data);
    // AUD-3: forbidden, as the guard answers a non-admin, when the actor lost the role meanwhile.
    if (!r.ok && r.code === "forbidden") return apiError(c, "forbidden");
    if (!r.ok)
      return apiError(c, "validationFailed", undefined, [{ key: "validation.emailTaken" }]);
    return c.json(
      CreateUserResponseSchema.parse({ user: r.user, temporaryPassword: r.temporaryPassword }),
      201,
    );
  });

  app.post(`${BASE}/:id/disable`, guard, async (c) => {
    const p = UserParamsSchema.safeParse({ id: c.req.param("id") });
    if (!p.success) return apiError(c, "validationFailed");
    const r = await disableUser(d, c.get("principal"), p.data.id);
    if (!r.ok) return apiError(c, r.code);
    return c.json(
      DisableUserResponseSchema.parse({ user: r.user, sessionsRevoked: r.sessionsRevoked }),
    );
  });

  app.put(`${BASE}/:id/role`, guard, async (c) => {
    const p = UserParamsSchema.safeParse({ id: c.req.param("id") });
    const body = await bodyOf(c, SetRoleBodySchema);
    if (!p.success || !body.success) return apiError(c, "validationFailed");
    const r = await setUserRole(d, c.get("principal"), p.data.id, body.data.role);
    if (!r.ok) return apiError(c, r.code);
    return c.json(AdminUserSchema.parse(r.user));
  });

  app.get(`${BASE}/:id/sessions`, guard, async (c) => {
    const p = UserParamsSchema.safeParse({ id: c.req.param("id") });
    if (!p.success) return apiError(c, "validationFailed");
    const sessions = await listUserSessions(d, c.get("principal"), p.data.id);
    if (!sessions) return apiError(c, "notFound");
    return c.json(AdminUserSessionListSchema.parse({ sessions }));
  });

  app.delete("/api/v1/admin/sessions/:sessionId", guard, async (c) => {
    const p = SessionParamsSchema.safeParse({ sessionId: c.req.param("sessionId") });
    if (!p.success) return apiError(c, "validationFailed");
    const r = await revokeSession(d, c.get("principal"), p.data.sessionId);
    if (!r.ok) return apiError(c, r.code);
    return c.body(null, 204);
  });
}
