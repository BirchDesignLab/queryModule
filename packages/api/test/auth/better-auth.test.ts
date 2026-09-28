import { BoundedIdSchema, Uuid7Schema } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
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

  it("does not hold the database lock via a transaction of its own (plan Task 6 carry-forward)", async () => {
    // The drizzle adapter never calls db.transaction() itself, so it never trips
    // NestedTransactionError or holds SerializedClient's single-connection lock across
    // calls. Two concurrent sign-ins would deadlock (or one would see the other's
    // uncommitted row) if the adapter opened and held its own transaction; both must
    // resolve independently, each with its own session row.
    const { auth, env, db } = await setup();
    await createLocalUser(auth, {
      email: "second@example.test",
      name: "Second Dispatcher",
      password: "another-long-password-1",
    });
    const signInAs = (email: string, password: string) =>
      auth.handler(
        new Request("http://localhost:3000/api/v1/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: env.publicOrigin },
          body: JSON.stringify({ email, password }),
        }),
      );
    const [r1, r2] = await Promise.all([
      signInAs("dispatcher@example.test", "correct-horse-battery-1"),
      signInAs("second@example.test", "another-long-password-1"),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const rows = (await db.$client.execute("SELECT id FROM session")).rows;
    expect(rows.length).toBe(2);
  });
});
