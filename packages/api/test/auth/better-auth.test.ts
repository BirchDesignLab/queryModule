import { BoundedIdSchema, Uuid7Schema } from "@querymodule/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth, sessionCookieName } from "../../src/auth/auth";
import { createLocalUser } from "../../src/auth/users";
import { migratedDb, TEST_SECRETS, testEnv } from "../helpers/fixture";

async function setup() {
  const env = testEnv();
  const db = await migratedDb(env);
  const auth = createAuth({
    db,
    env,
    secret: TEST_SECRETS.betterAuthSecret,
    session: { absoluteMinutes: 720, idleMinutes: 30 },
  });
  await createLocalUser(auth, {
    email: "Dispatcher@Example.test",
    name: "Demo Dispatcher",
    password: "correct-horse-battery-1",
  });
  const signIn = (password: string) =>
    auth.handler(
      new Request("http://localhost:3000/api/v1/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: env.publicOrigin },
        body: JSON.stringify({ email: "dispatcher@example.test", password }),
      }),
    );
  return { env, db, auth, signIn };
}

describe("SEC-005 Better Auth", () => {
  it("sets the __Host- session cookie with the required attributes", async () => {
    const { signIn } = await setup();
    const r = await signIn("correct-horse-battery-1");
    expect(r.status).toBe(200);
    const c = r.headers.getSetCookie().find((s) => s.startsWith("__Host-qm_session="));
    expect(c).toBeDefined();
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Path=\//);
    expect(c).not.toMatch(/Domain=/i);
  });

  it("uses qm_session only in development", () => {
    expect(sessionCookieName(testEnv({ NODE_ENV: "development" }))).toBe("qm_session");
    expect(sessionCookieName(testEnv({ NODE_ENV: "production" }))).toBe("__Host-qm_session");
  });

  it("rejects a wrong password with 401", async () => {
    const { signIn } = await setup();
    expect((await signIn("wrong-password-000")).status).toBe(401);
  });

  it("has public sign-up disabled", async () => {
    const { auth, env } = await setup();
    const r = await auth.handler(
      new Request("http://localhost:3000/api/v1/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: env.publicOrigin },
        body: JSON.stringify({
          email: "new@example.test",
          password: "another-long-password-1",
          name: "N",
        }),
      }),
    );
    expect(r.status).not.toBe(200);
  });

  it("sets session expiry to the absolute limit and stores UUIDv7 ids", async () => {
    const { signIn, db } = await setup();
    await signIn("correct-horse-battery-1");
    const row = (await db.$client.execute("SELECT id, created_at, expires_at FROM session"))
      .rows[0];
    expect(Number(row?.expires_at) - Number(row?.created_at)).toBeCloseTo(720 * 60_000, -4);
    expect(String(row?.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it("creates users with a BoundedIdSchema, UUIDv7 id (#65)", async () => {
    const env = testEnv();
    const db = await migratedDb(env);
    const auth = createAuth({
      db,
      env,
      secret: TEST_SECRETS.betterAuthSecret,
      session: { absoluteMinutes: 720, idleMinutes: 30 },
    });
    const { id } = await createLocalUser(auth, {
      email: "bounded@example.test",
      name: "Bounded Id",
      password: "correct-horse-battery-1",
    });
    expect(Uuid7Schema.safeParse(id).success).toBe(true);
    expect(BoundedIdSchema.safeParse(id).success).toBe(true);
  });

  it("has telemetry disabled", async () => {
    const { auth } = await setup();
    expect(auth.options.telemetry?.enabled).toBe(false);
  });

  describe("BETTER_AUTH_TELEMETRY env override (fail closed, plan Task 6 amendment)", () => {
    const key = "BETTER_AUTH_TELEMETRY";
    const original = process.env[key];
    afterEach(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });

    it("refuses to start when BETTER_AUTH_TELEMETRY is truthy", async () => {
      const { db, env } = await setup();
      process.env[key] = "1";
      expect(() =>
        createAuth({
          db,
          env,
          secret: TEST_SECRETS.betterAuthSecret,
          session: { absoluteMinutes: 720, idleMinutes: 30 },
        }),
      ).toThrow(/BETTER_AUTH_TELEMETRY/);
    });
  });

  it("never opens its own database transaction, across createLocalUser, sign-in, get-session and sign-out (plan Task 6 carry-forward)", async () => {
    // The drizzle adapter's own db.transaction() calls are all gated to `provider: "mysql"`
    // except one behind `config.transaction` (default false); auth.ts now pins
    // `transaction: false` explicitly. A transaction of its own would trip
    // NestedTransactionError or hold SerializedClient's single-connection lock; the drizzle
    // instance passed to the adapter must never be asked to open one.
    const { auth, env, db } = await setup();
    const transactionSpy = vi.spyOn(db, "transaction");

    await createLocalUser(auth, {
      email: "second@example.test",
      name: "Second Dispatcher",
      password: "another-long-password-1",
    });

    const signInResponse = await auth.handler(
      new Request("http://localhost:3000/api/v1/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: env.publicOrigin },
        body: JSON.stringify({
          email: "dispatcher@example.test",
          password: "correct-horse-battery-1",
        }),
      }),
    );
    expect(signInResponse.status).toBe(200);
    const sessionSetCookie = signInResponse.headers
      .getSetCookie()
      .find((c) => c.includes("qm_session="));
    expect(sessionSetCookie).toBeDefined();
    const sessionCookie = sessionSetCookie?.split(";")[0] ?? "";

    const getSessionResponse = await auth.handler(
      new Request("http://localhost:3000/api/v1/auth/get-session", {
        headers: { cookie: sessionCookie, origin: env.publicOrigin },
      }),
    );
    expect(getSessionResponse.status).toBe(200);

    const signOutResponse = await auth.handler(
      new Request("http://localhost:3000/api/v1/auth/sign-out", {
        method: "POST",
        headers: { cookie: sessionCookie, origin: env.publicOrigin },
      }),
    );
    expect(signOutResponse.status).toBe(200);

    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("does not expose set-auth-token to a web (Origin-bearing) sign-in (spec 5.6)", async () => {
    const { signIn } = await setup();
    const r = await signIn("correct-horse-battery-1");
    expect(r.status).toBe(200);
    expect(r.headers.get("set-auth-token")).toBeNull();
    const exposed = (r.headers.get("access-control-expose-headers") ?? "").toLowerCase();
    expect(exposed).not.toContain("set-auth-token");
  });

  it("rejects an unsigned raw session token presented as Authorization: Bearer (SEC-005)", async () => {
    const { auth, signIn, db } = await setup();
    await signIn("correct-horse-battery-1");
    const row = (await db.$client.execute("SELECT token FROM session")).rows[0];
    const rawToken = String(row?.token);
    expect(rawToken).not.toContain("."); // the raw stored token is unsigned

    const r = await auth.handler(
      new Request("http://localhost:3000/api/v1/auth/get-session", {
        headers: { authorization: `Bearer ${rawToken}` },
      }),
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toBeNull();
  });
});
