import { ApiErrorSchema, AuditActorSchema } from "@querymodule/core/contracts";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type Auth, createAuth } from "../../src/auth/auth";
import { createIdentityService } from "../../src/auth/identity";
import { createLocalUser } from "../../src/auth/users";
import { requireSession } from "../../src/http/session";
import type { AppEnv } from "../../src/http/types";
import { actorOf } from "../../src/seams";
import {
  captureLogger,
  createTestClock,
  migratedDb,
  TEST_SECRETS,
  testEnv,
} from "../helpers/fixture";

const MIN = 60_000;
async function setup(email = "dispatcher@example.test") {
  const env = testEnv();
  const db = await migratedDb(env);
  const limits = { absoluteMinutes: 720, idleMinutes: 30 };
  const auth = createAuth({ db, env, secret: TEST_SECRETS.betterAuthSecret, session: limits });
  const { id } = await createLocalUser(auth, {
    email,
    name: "Demo Dispatcher",
    password: "correct-horse-battery-1",
  });
  const clock = createTestClock();
  const log = captureLogger();
  const identity = createIdentityService({ db, auth, limits: () => limits, clock, log });
  const r = await auth.handler(
    new Request("http://localhost:3000/api/v1/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: env.publicOrigin },
      body: JSON.stringify({ email, password: "correct-horse-battery-1" }),
    }),
  );
  const cookie = (r.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
  const req = (bg = false) =>
    new Request("http://localhost:3000/api/v1/config", {
      headers: { cookie, ...(bg ? { "x-background": "1" } : {}) },
    });
  return { db, auth, limits, clock, log, identity, req, cookie, userId: id };
}

describe("SEC-005 session limits", () => {
  it("resolves a principal from the cookie", async () => {
    const { identity, req, userId } = await setup();
    expect(await identity.resolve(req())).toMatchObject({
      userId,
      email: "dispatcher@example.test",
      role: "user",
      identitySource: "local",
    });
  });
  it("returns null with no cookie", async () => {
    const { identity } = await setup();
    expect(await identity.resolve(new Request("http://localhost:3000/"))).toBeNull();
  });
  it("expires after 30 idle minutes", async () => {
    const { identity, req, clock } = await setup();
    clock.advance(31 * MIN);
    expect(await identity.resolve(req())).toBeNull();
  });
  it("user activity refreshes the idle clock", async () => {
    const { identity, req, clock } = await setup();
    clock.advance(20 * MIN);
    expect(await identity.resolve(req())).not.toBeNull();
    clock.advance(20 * MIN);
    expect(await identity.resolve(req())).not.toBeNull();
  });
  it("X-Background does not refresh the idle clock", async () => {
    const { identity, req, clock } = await setup();
    clock.advance(20 * MIN);
    expect(await identity.resolve(req(true))).not.toBeNull();
    clock.advance(11 * MIN);
    expect(await identity.resolve(req())).toBeNull();
  });
  it("expires at 12 hours absolute despite activity", async () => {
    const { identity, req, clock } = await setup();
    for (let i = 0; i < 24; i++) {
      clock.advance(29 * MIN);
      expect(await identity.resolve(req())).not.toBeNull();
    }
    clock.advance(25 * MIN);
    expect(await identity.resolve(req())).toBeNull();
  });
  it("a disabled user resolves to null", async () => {
    const { identity, req, db, userId } = await setup();
    await db.$client.execute({
      sql: "UPDATE user SET disabled_at = 1 WHERE id = ?",
      args: [userId],
    });
    expect(await identity.resolve(req())).toBeNull();
  });
  it("a getSession failure resolves to null and logs a warning without the cookie", async () => {
    const { db, auth, limits, clock, req, cookie } = await setup();
    const log = captureLogger();
    const broken = {
      ...auth,
      api: {
        ...auth.api,
        getSession: () => Promise.reject(new RangeError("database unavailable")),
      },
    } as unknown as Auth;
    const identity = createIdentityService({ db, auth: broken, limits: () => limits, clock, log });
    expect(await identity.resolve(req())).toBeNull();
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({
      level: "warn",
      msg: "session resolution failed",
      f: { errorName: "RangeError" },
    });
    const cookieValue = cookie.split("=").slice(1).join("=");
    expect(cookieValue.length).toBeGreaterThan(8);
    expect(JSON.stringify(log.entries)).not.toContain(cookieValue);
  });
  it("isSessionLive tracks the same limits without refreshing", async () => {
    const { identity, req, clock } = await setup();
    const p = await identity.resolve(req());
    clock.advance(29 * MIN);
    expect(await identity.isSessionLive(p?.sessionId ?? "")).toBe(true);
    clock.advance(2 * MIN);
    expect(await identity.isSessionLive(p?.sessionId ?? "")).toBe(false);
  });
  it("requireSession answers 401 unauthenticated", async () => {
    const { identity } = await setup();
    const app = new Hono<AppEnv>();
    app.get("/api/v1/config", requireSession(identity), (c) =>
      c.json({ userId: c.get("principal").userId }),
    );
    const r = await app.request("/api/v1/config");
    expect(r.status).toBe(401);
    expect(ApiErrorSchema.parse(await r.json()).error.code).toBe("unauthenticated");
  });
  it("requireSession sets the principal for a live session", async () => {
    const { identity, req, userId } = await setup();
    const app = new Hono<AppEnv>();
    app.get("/api/v1/config", requireSession(identity), (c) =>
      c.json({ userId: c.get("principal").userId }),
    );
    const r = await app.request(req());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ userId });
  });
});

describe("SEC-014 audit actor email", () => {
  it("stores email null when Better Auth accepts an address the audit actor schema rejects", async () => {
    // 260 characters: z.email() (Better Auth's sign-in check) has no length cap, but
    // AuditActorSchema caps email at 254, so an audit write with it would fail every submit.
    const label = "b".repeat(60);
    const long = `${"a".repeat(64)}@${label}.${label}.${label}.example.test`;
    expect(long.length).toBeGreaterThan(254);
    const { identity, req, userId } = await setup(long);
    const p = await identity.resolve(req());
    expect(p).toMatchObject({ userId, email: null });
    if (!p) throw new Error("expected a principal");
    expect(AuditActorSchema.parse(actorOf(p))).toEqual({ id: userId, email: null, role: "user" });
  });
});
