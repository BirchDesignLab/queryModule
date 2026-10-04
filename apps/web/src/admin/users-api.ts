import type { ApiClient } from "@querymodule/client";
import {
  type AdminUser,
  AdminUserListSchema,
  AdminUserSchema,
  AdminUserSessionListSchema,
  CreateUserResponseSchema,
  DisableUserResponseSchema,
  type Role,
} from "@querymodule/core/contracts";

/**
 * The AC2 user routes (ADR-0011 item 8, Task 28) through the typed client, parsed against the
 * contract. Nothing here logs or keeps a response: the one that carries the temporary password
 * goes straight to the caller, which keeps it in component state until its dialog closes (SEC-005).
 */

/** GET /api/v1/admin/users, or null when it cannot be loaded. */
export async function fetchUsers(api: ApiClient): Promise<AdminUser[] | null> {
  try {
    const { data } = await api.GET("/api/v1/admin/users");
    const parsed = AdminUserListSchema.safeParse(data);
    return parsed.success ? parsed.data.users : null;
  } catch {
    return null;
  }
}

export type CreateResult =
  | { ok: true; user: AdminUser; temporaryPassword: string }
  | { ok: false; reason: "emailTaken" | "invalid" | "error" };

/** POST /api/v1/admin/users: 201 with the one-time password, or 400 with the field's reason. */
export async function createUser(
  api: ApiClient,
  body: { email: string; name: string; role: Role },
): Promise<CreateResult> {
  try {
    const { data, error, response } = await api.POST("/api/v1/admin/users", { body });
    if (response.status === 400) {
      const keys = (error as { error?: { errors?: { key: string }[] } } | undefined)?.error?.errors;
      return {
        ok: false,
        reason:
          keys?.some((e) => e.key === "validation.emailTaken") === true ? "emailTaken" : "invalid",
      };
    }
    const parsed = CreateUserResponseSchema.safeParse(data);
    return parsed.success
      ? { ok: true, user: parsed.data.user, temporaryPassword: parsed.data.temporaryPassword }
      : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

export type ChangeResult<T> = { ok: true; value: T } | { ok: false; reason: "lastAdmin" | "error" };

/** PUT /api/v1/admin/users/{id}/role; 409 lastAdmin covers the self case. */
export async function setUserRole(
  api: ApiClient,
  id: string,
  role: Role,
): Promise<ChangeResult<AdminUser>> {
  try {
    const { data, response } = await api.PUT("/api/v1/admin/users/{id}/role", {
      params: { path: { id } },
      body: { role },
    });
    if (response.status === 409) return { ok: false, reason: "lastAdmin" };
    const parsed = AdminUserSchema.safeParse(data);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** POST /api/v1/admin/users/{id}/disable: disabled, sessions revoked in one transaction. */
export async function disableUser(
  api: ApiClient,
  id: string,
): Promise<ChangeResult<{ user: AdminUser; sessionsRevoked: number }>> {
  try {
    const { data, response } = await api.POST("/api/v1/admin/users/{id}/disable", {
      params: { path: { id } },
    });
    if (response.status === 409) return { ok: false, reason: "lastAdmin" };
    const parsed = DisableUserResponseSchema.safeParse(data);
    return parsed.success
      ? {
          ok: true,
          value: { user: parsed.data.user, sessionsRevoked: parsed.data.sessionsRevoked },
        }
      : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Ends every session of a user but the caller's own (revoking that one would sign the admin out
 * from a row action). The list answers at most 100 sessions (the contract's cap), so it lists,
 * deletes and lists again until none but the caller's remain. A session listed again after its
 * delete answered means the revoke did not hold: that is a failure, not a success. The count of
 * sessions ended, or null when a list or delete failed or any session survived (AC-1).
 */
export async function revokeUserSessions(api: ApiClient, id: string): Promise<number | null> {
  try {
    const attempted = new Set<string>();
    for (;;) {
      const { data } = await api.GET("/api/v1/admin/users/{id}/sessions", {
        params: { path: { id } },
      });
      const parsed = AdminUserSessionListSchema.safeParse(data);
      if (!parsed.success) return null;
      const others = parsed.data.sessions.filter((s) => !s.current);
      if (others.length === 0) return attempted.size;
      if (others.some((s) => attempted.has(s.id))) return null;
      for (const s of others) {
        attempted.add(s.id);
        const { response } = await api.DELETE("/api/v1/admin/sessions/{sessionId}", {
          params: { path: { sessionId: s.id } },
        });
        if (!response.ok && response.status !== 404) return null;
      }
    }
  } catch {
    return null;
  }
}
