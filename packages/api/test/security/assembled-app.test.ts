import { ApiErrorSchema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/test-app";

const EMAIL = "dispatcher@example.test";
const PW = "correct-horse-battery-1";

function assertSecurityHeaders(r: Response, label: string | number) {
  expect(r.headers.get("x-content-type-options"), String(label)).toBe("nosniff");
  expect(r.headers.get("referrer-policy"), String(label)).toBe("no-referrer");
  expect(r.headers.get("strict-transport-security"), String(label)).toBe("max-age=31536000");
  expect(r.headers.get("permissions-policy"), String(label)).toBe(
    "camera=(), microphone=(), geolocation=()",
  );
  expect(r.headers.get("cache-control"), String(label)).toBe("no-store");
}

// Carry-forward #120: the app assembled by createApp/buildDeps must run requestId, then
// securityHeaders on *, noStore on /api/*, bodyCap and requireRequestedWith on /api/v1/*, in
// that order, and Better Auth routes stay exempt from the CSRF check except POST sign-out (#289).
describe("carry-forward #120: assembled app middleware order", () => {
  it("sets security headers and no-store on a 200 from the assembled app", async () => {
    const t = await createTestApp();
    const r = await t.request("/api/v1/auth/get-session");
    expect(r.status).toBe(200);
    assertSecurityHeaders(r, 200);
  });

  it("enforces CSRF on a state-changing non-Better-Auth route (POST /api/v1/auth/embedded) and still sets security headers", async () => {
    const t = await createTestApp();
    const r = await t.request("/api/v1/auth/embedded", { method: "POST" });
    expect(r.status).toBe(403);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("forbidden");
    assertSecurityHeaders(r, 403);
  });

  it("enforces the 32 KiB body cap on the assembled app and still sets security headers", async () => {
    const t = await createTestApp();
    const r = await t.request("/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x", password: "x".repeat(33 * 1024) }),
    });
    expect(r.status).toBe(413);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("payloadTooLarge");
    assertSecurityHeaders(r, 413);
  });

  it("enforces CSRF on POST /api/v1/auth/sign-out, the one Better Auth path that needs X-Requested-With (#289)", async () => {
    const t = await createTestApp();
    const r = await t.request("/api/v1/auth/sign-out", { method: "POST" });
    expect(r.status).toBe(403);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("forbidden");
    assertSecurityHeaders(r, 403);
  });

  it("leaves every other Better Auth route exempt from the CSRF check (no X-Requested-With needed)", async () => {
    const t = await createTestApp();
    await t.createUser(EMAIL, PW);
    const r = await t.signIn(EMAIL, PW); // signIn sends no x-requested-with header
    expect(r.status).toBe(200);
    assertSecurityHeaders(r, 200);
  });
});
