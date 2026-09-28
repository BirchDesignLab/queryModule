import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AUTH_LIMITS, clientIp, createRateLimiter } from "../../src/auth/rate-limit";
import type { AppEnv } from "../../src/http/types";
import { createTestClock, migratedDb, testEnv } from "../helpers/fixture";

const MIN = 60_000;

describe("SEC-005 rate limiter", () => {
  it("allows 100 per window then 429 with retry-after, then resets", async () => {
    const clock = createTestClock();
    const l = createRateLimiter(await migratedDb(testEnv()), clock);
    for (let i = 0; i < 100; i++)
      expect((await l.hit("login:ip:a", 100, 15 * MIN)).allowed).toBe(true);
    const over = await l.hit("login:ip:a", 100, 15 * MIN);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
    clock.advance(15 * MIN);
    expect((await l.hit("login:ip:a", 100, 15 * MIN)).allowed).toBe(true);
  });
  it("locks on the 10th failure for 15 minutes", async () => {
    const clock = createTestClock();
    const l = createRateLimiter(await migratedDb(testEnv()), clock);
    const f = AUTH_LIMITS.accountFailures;
    for (let i = 0; i < 9; i++)
      expect((await l.recordFailure("login:acct:x", f)).lockedUntil).toBeNull();
    // createTestClock reads real Date.now() under an offset, so bracket the assertion around the
    // recordFailure call instead of comparing to a clock.now() read after it resolves: real time
    // (including the sqlite writes above) can tick between the two reads and make an exact
    // equality assertion flake.
    const before = clock.now();
    const tenth = await l.recordFailure("login:acct:x", f);
    const after = clock.now();
    expect(tenth.lockedUntil).not.toBeNull();
    expect(tenth.lockedUntil as number).toBeGreaterThanOrEqual(before + 15 * MIN);
    expect(tenth.lockedUntil as number).toBeLessThanOrEqual(after + 15 * MIN);
    expect(await l.lockedUntil("login:acct:x")).toBe(tenth.lockedUntil);
    clock.advance(15 * MIN + 1);
    expect(await l.lockedUntil("login:acct:x")).toBeNull();
  });
  it("state survives a new limiter on the same database", async () => {
    const env = testEnv();
    const clock = createTestClock();
    const db = await migratedDb(env);
    const a = createRateLimiter(db, clock);
    for (let i = 0; i < 10; i++) await a.recordFailure("login:acct:y", AUTH_LIMITS.accountFailures);
    expect(await createRateLimiter(db, clock).lockedUntil("login:acct:y")).not.toBeNull();
  });
  it("reset clears a key's count and lock", async () => {
    const clock = createTestClock();
    const l = createRateLimiter(await migratedDb(testEnv()), clock);
    for (let i = 0; i < 10; i++) await l.recordFailure("login:acct:z", AUTH_LIMITS.accountFailures);
    expect(await l.lockedUntil("login:acct:z")).not.toBeNull();
    await l.reset("login:acct:z");
    expect(await l.lockedUntil("login:acct:z")).toBeNull();
    expect(
      (await l.recordFailure("login:acct:z", AUTH_LIMITS.accountFailures)).lockedUntil,
    ).toBeNull();
  });
  it("trusts CF-Connecting-IP only in production", async () => {
    const mk = (env: ReturnType<typeof testEnv>) => {
      const app = new Hono<AppEnv>();
      app.get("/", (c) => c.text(clientIp(c, env)));
      return app;
    };
    const h = { "cf-connecting-ip": "203.0.113.7" };
    expect(
      await (await mk(testEnv({ NODE_ENV: "production" })).request("/", { headers: h })).text(),
    ).toBe("203.0.113.7");
    expect(await (await mk(testEnv()).request("/", { headers: h })).text()).toBe("local");
  });
  it("returns unknown for a malformed CF-Connecting-IP in production instead of throwing (#104 C-M1)", async () => {
    const app = new Hono<AppEnv>();
    const env = testEnv({ NODE_ENV: "production" });
    app.get("/", (c) => c.text(clientIp(c, env)));
    const malformed = { "cf-connecting-ip": "a, b, <script>evil</script>" };
    expect(await (await app.request("/", { headers: malformed })).text()).toBe("unknown");
  });
  it("returns unknown when CF-Connecting-IP is absent in production", async () => {
    const app = new Hono<AppEnv>();
    const env = testEnv({ NODE_ENV: "production" });
    app.get("/", (c) => c.text(clientIp(c, env)));
    expect(await (await app.request("/")).text()).toBe("unknown");
  });
});
