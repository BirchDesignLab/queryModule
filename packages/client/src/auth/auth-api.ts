export const AUTH_BASE_PATH = "/api/v1/auth";

export interface SessionUser {
  id: string;
  email: string;
  role: string | null;
  /** D-A26: present (true) only while an admin-created user keeps the temporary password. */
  mustChangePassword?: true;
}

export type AuthErrorCode = "unauthenticated" | "rateLimited" | "unavailable" | "forbidden";

export type SignInResult =
  | { ok: true; user: SessionUser }
  | { ok: false; code: AuthErrorCode; retryAfterSeconds: number | null };

/**
 * Why a change-password was refused (D-A26). Codes only: the server's wording is never shown.
 * `samePassword` is the server's 400 validationFailed (the new password equals the current one).
 */
export type ChangePasswordCode =
  | "samePassword"
  | "incorrect"
  | "tooShort"
  | "rateLimited"
  | "unauthenticated"
  | "unavailable";

export type ChangePasswordResult = { ok: true } | { ok: false; code: ChangePasswordCode };

export interface AuthApi {
  signInEmail(email: string, password: string): Promise<SignInResult>;
  signOut(options?: { signal?: AbortSignal }): Promise<void>;
  getSession(): Promise<SessionUser | null>;
  /** Better Auth change-password for the signed-in user; the other sessions stay (D-A26). */
  changePassword(currentPassword: string, newPassword: string): Promise<ChangePasswordResult>;
}

export interface AuthApiOptions {
  baseUrl: string;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

export function parseSessionUser(value: unknown): SessionUser | null {
  if (typeof value !== "object" || value === null) return null;
  const user = (value as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return null;
  const { id, email, role, mustChangePassword } = user as {
    id?: unknown;
    email?: unknown;
    role?: unknown;
    mustChangePassword?: unknown;
  };
  if (typeof id !== "string" || typeof email !== "string") return null;
  const parsed: SessionUser = { id, email, role: typeof role === "string" ? role : null };
  return mustChangePassword === true ? { ...parsed, mustChangePassword: true } : parsed;
}

function failure(code: AuthErrorCode, retryAfterSeconds: number | null = null): SignInResult {
  return { ok: false, code, retryAfterSeconds };
}

/** Generic messages only: a bad password and an unknown account look the same (spec 5.6). */
function readFailure(response: Response): SignInResult {
  if (response.status === 429) {
    const header = response.headers.get("retry-after");
    return failure("rateLimited", header !== null && /^\d+$/.test(header) ? Number(header) : null);
  }
  if (response.status === 403) return failure("forbidden");
  if (response.status >= 500) return failure("unavailable");
  return failure("unauthenticated");
}

async function readChangeFailure(response: Response): Promise<ChangePasswordResult> {
  if (response.status === 429) return { ok: false, code: "rateLimited" };
  if (response.status === 401 || response.status === 403)
    return { ok: false, code: "unauthenticated" };
  if (response.status !== 400) return { ok: false, code: "unavailable" };
  const body: unknown = await response.json().catch(() => null);
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : null;
  if (code === "INVALID_PASSWORD") return { ok: false, code: "incorrect" };
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG")
    return { ok: false, code: "tooShort" };
  // The app's own 400 validationFailed: the new password is the current one (G-I4).
  return { ok: false, code: "samePassword" };
}

/** Better Auth handlers at /api/v1/auth/* (spec 5.1, 5.6). Not in OpenAPI, so plain fetch. */
export function createAuthApi(options: AuthApiOptions): AuthApi {
  const send = (path: string, init: RequestInit): Promise<Response> =>
    (
      options.fetch ??
      ((input: string, requestInit: RequestInit) => globalThis.fetch(input, requestInit))
    )(`${options.baseUrl}${AUTH_BASE_PATH}${path}`, {
      cache: "no-store",
      credentials: "include",
      ...init,
    });
  const json = { "content-type": "application/json" };
  return {
    async signInEmail(email, password) {
      let response: Response;
      try {
        response = await send("/sign-in/email", {
          method: "POST",
          headers: json,
          body: JSON.stringify({ email, password }),
        });
      } catch {
        return failure("unavailable");
      }
      if (!response.ok) return readFailure(response);
      const user = parseSessionUser(await response.json());
      return user === null ? failure("unavailable") : { ok: true, user };
    },
    async signOut(o) {
      // Throws on a network failure or a non-2xx: the server session (and its cookie) may still
      // be valid, so the caller must be able to say so (SEC-006, spec 5.6). The controller still
      // wipes local state first.
      // #289: the server deletes the session before Better Auth runs, so sign-out needs the
      // app's own X-Requested-With guard (every caller, the #241 retry included, comes here).
      const response = await send("/sign-out", {
        method: "POST",
        headers: { ...json, "x-requested-with": "querymodule" },
        body: "{}",
        ...(o?.signal === undefined ? {} : { signal: o.signal }),
      });
      if (!response.ok) throw new Error(`sign-out failed: ${response.status}`);
    },
    async changePassword(currentPassword, newPassword) {
      let response: Response;
      try {
        response = await send("/change-password", {
          method: "POST",
          headers: { ...json, "x-requested-with": "querymodule" },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
      } catch {
        return { ok: false, code: "unavailable" };
      }
      return response.ok ? { ok: true } : readChangeFailure(response);
    },
    async getSession() {
      try {
        const response = await send("/get-session", { method: "GET" });
        return response.ok ? parseSessionUser(await response.json()) : null;
      } catch {
        // A network failure looks like "no session"; the controller treats both as signed out.
        return null;
      }
    },
  };
}
