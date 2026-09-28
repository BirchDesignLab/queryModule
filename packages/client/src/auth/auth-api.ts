export const AUTH_BASE_PATH = "/api/v1/auth";

export interface SessionUser {
  id: string;
  email: string;
  role: string | null;
}

export type AuthErrorCode = "unauthenticated" | "rateLimited" | "unavailable" | "forbidden";

export type SignInResult =
  | { ok: true; user: SessionUser }
  | { ok: false; code: AuthErrorCode; retryAfterSeconds: number | null };

export interface AuthApi {
  signInEmail(email: string, password: string): Promise<SignInResult>;
  signOut(): Promise<void>;
  getSession(): Promise<SessionUser | null>;
}

export interface AuthApiOptions {
  baseUrl: string;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

export function parseSessionUser(value: unknown): SessionUser | null {
  if (typeof value !== "object" || value === null) return null;
  const user = (value as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return null;
  const { id, email, role } = user as { id?: unknown; email?: unknown; role?: unknown };
  if (typeof id !== "string" || typeof email !== "string") return null;
  return { id, email, role: typeof role === "string" ? role : null };
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
    async signOut() {
      // Throws on a network failure or a non-2xx: the server session (and its cookie) may still
      // be valid, so the caller must be able to say so (SEC-006, spec 5.6). The controller still
      // wipes local state first.
      const response = await send("/sign-out", { method: "POST", headers: json, body: "{}" });
      if (!response.ok) throw new Error(`sign-out failed: ${response.status}`);
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
