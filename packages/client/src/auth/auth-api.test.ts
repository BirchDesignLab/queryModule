import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAuthApi, parseSessionUser } from "./auth-api.js";

const BASE = "http://api.test";
const USER = { id: "user-0001", email: "tester@querymodule.test", role: "user" };
const PASSWORD = "fixture-only-pass";
const seen: Request[] = [];

const server = setupServer(
  http.post(`${BASE}/api/v1/auth/sign-in/email`, async ({ request }) => {
    seen.push(request.clone());
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === "busy@querymodule.test")
      return new HttpResponse(null, { status: 429, headers: { "Retry-After": "30" } });
    if (body.email === "down@querymodule.test") return new HttpResponse(null, { status: 503 });
    if (body.email === USER.email && body.password === PASSWORD)
      return HttpResponse.json({ redirect: false, token: "t", user: USER });
    return HttpResponse.json(
      { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      { status: 401 },
    );
  }),
  http.get(`${BASE}/api/v1/auth/get-session`, () =>
    HttpResponse.json({ session: { id: "s1" }, user: USER }),
  ),
  http.post(`${BASE}/api/v1/auth/sign-out`, () => HttpResponse.json({ success: true })),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
});
afterAll(() => server.close());

describe("BR-002 standalone login through Better Auth (spec 5.6)", () => {
  const api = createAuthApi({ baseUrl: BASE });
  it("signs in and returns the session user", async () => {
    expect(await api.signInEmail(USER.email, PASSWORD)).toEqual({ ok: true, user: USER });
    expect(seen[0]?.cache).toBe("no-store");
    expect(seen[0]?.credentials).toBe("include");
  });
  it("maps a bad password to a generic unauthenticated result", async () => {
    expect(await api.signInEmail(USER.email, "wrong")).toEqual({
      ok: false,
      code: "unauthenticated",
      retryAfterSeconds: null,
    });
  });
  it("maps the limiter to rateLimited with Retry-After", async () => {
    expect(await api.signInEmail("busy@querymodule.test", "x")).toEqual({
      ok: false,
      code: "rateLimited",
      retryAfterSeconds: 30,
    });
  });
  it("maps a 5xx and a network failure to unavailable", async () => {
    expect(await api.signInEmail("down@querymodule.test", "x")).toMatchObject({
      ok: false,
      code: "unavailable",
    });
    server.use(http.post(`${BASE}/api/v1/auth/sign-in/email`, () => HttpResponse.error()));
    expect(await api.signInEmail(USER.email, PASSWORD)).toMatchObject({
      ok: false,
      code: "unavailable",
    });
  });
  it("reads the session and returns null when there is none", async () => {
    expect(await api.getSession()).toEqual(USER);
    server.use(http.get(`${BASE}/api/v1/auth/get-session`, () => HttpResponse.json(null)));
    expect(await api.getSession()).toBeNull();
  });
  it("signOut resolves when the server ends the session", async () => {
    await expect(api.signOut()).resolves.toBeUndefined();
  });
  it("SEC-006: signOut throws on a network failure, since the server session may still be valid", async () => {
    server.use(http.post(`${BASE}/api/v1/auth/sign-out`, () => HttpResponse.error()));
    await expect(api.signOut()).rejects.toThrow();
  });
  it("signOut passes its abort signal to the request (W4)", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(api.signOut({ signal: controller.signal })).rejects.toThrow();
  });
  it("SEC-006: signOut throws on a non-2xx response", async () => {
    server.use(
      http.post(`${BASE}/api/v1/auth/sign-out`, () => new HttpResponse(null, { status: 503 })),
    );
    await expect(api.signOut()).rejects.toThrow(/503/);
  });
  it("getSession never throws on a network failure", async () => {
    server.use(http.get(`${BASE}/api/v1/auth/get-session`, () => HttpResponse.error()));
    await expect(api.getSession()).resolves.toBeNull();
  });
  it("parseSessionUser rejects malformed bodies", () => {
    expect(parseSessionUser({ user: { id: 1, email: "x" } })).toBeNull();
    expect(parseSessionUser({ user: { id: "u", email: "x@querymodule.test" } })).toEqual({
      id: "u",
      email: "x@querymodule.test",
      role: null,
    });
    expect(parseSessionUser("nope")).toBeNull();
  });
});
