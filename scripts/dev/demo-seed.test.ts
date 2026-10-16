import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DEMO_EMAIL,
  DEMO_STORIES,
  type DemoFetch,
  DemoSeedRefusedError,
  demoEmailFromEnv,
  demoPassword,
  passwordFromEnv,
  runDemoSeed,
} from "./demo-seed.ts";

const ORIGIN = "http://localhost:3100";
const HASH = "a".repeat(64);

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A scripted server: records every call, answers sign-in, config, submit and list. */
function fakeServer(opts: {
  existing?: number;
  signIn?: number;
  submit?: number;
  settleAfterPolls?: number;
}) {
  const calls: Call[] = [];
  let submitted = 0;
  let polls = 0;
  const fetchFn: DemoFetch = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname + u.search, headers, body });
    const json = (status: number, data: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json", ...extra },
      });
    if (u.pathname === "/api/v1/auth/sign-in/email") {
      const status = opts.signIn ?? 200;
      return status === 200
        ? json(
            200,
            {},
            { "set-cookie": "__Host-qm_session=abc123; Path=/; HttpOnly; SameSite=Lax" },
          )
        : json(status, { error: { code: "invalidCredentials" } });
    }
    if (u.pathname === "/api/v1/config") return json(200, { configHash: HASH });
    if (u.pathname === "/api/v1/queries" && method === "POST") {
      submitted += 1;
      const status = opts.submit ?? 202;
      return status === 202
        ? json(202, { correlationId: `cid-${submitted}`, acknowledgedAt: 1, parts: [] })
        : json(status, { error: { code: "validationFailed" } });
    }
    if (u.pathname === "/api/v1/queries") {
      polls += 1;
      if (submitted === 0) {
        const requests = Array.from({ length: opts.existing ?? 0 }, (_, i) => ({
          correlationId: `old-${i}`,
          parts: [],
        }));
        return json(200, { requests, nextCursor: null });
      }
      const settled = polls > (opts.settleAfterPolls ?? 0) + 1;
      const requests = Array.from({ length: submitted }, (_, i) => ({
        correlationId: `cid-${i + 1}`,
        parts: [{ sources: [{ status: settled ? "returned" : "pending" }] }],
      }));
      return json(200, { requests, nextCursor: null });
    }
    return json(404, {});
  };
  return { calls, fetchFn };
}

const noSleep = async () => {};

describe("demoPassword", () => {
  it("derives base64url(HMAC-SHA256(trimmed secret, lowercase email)) like scripts/ops/smoke.sh", () => {
    const expected = createHmac("sha256", "s3cret").update(DEMO_EMAIL).digest("base64url");
    expect(demoPassword("  s3cret\n", "Dispatcher@Example.test")).toBe(expected);
  });
});

describe("DEMO_STORIES", () => {
  it("covers every demo story once, each with unique ids and only synthetic trigger values", () => {
    const ids = DEMO_STORIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "veh-stolen",
        "veh-no-record",
        "veh-calm-hit",
        "veh-partial",
        "veh-timeout",
        "wnt-wanted",
        "dl-zzdltest",
        "per-hit",
      ]),
    );
    // The submit rate limiter allows 30 per user per minute (docs/api.md): one run stays well under it.
    expect(DEMO_STORIES.length).toBeLessThan(30);
    for (const s of DEMO_STORIES) {
      // A wanted check is national only; everything else asks both sources.
      expect(s.sourceIds).toEqual(
        s.queryType === "WNT" ? ["nationalSource"] : ["stateSource", "nationalSource"],
      );
      expect(`demo-seed-${s.id}`.length).toBeGreaterThanOrEqual(16);
    }
  });

  it("sends the year on every vehicle story, so both sources run as the story table says (VEH.ZZ-0001..26)", () => {
    const vehicles = DEMO_STORIES.filter((s) => s.queryType === "VEH");
    expect(vehicles.length).toBeGreaterThanOrEqual(5);
    for (const s of vehicles) expect(s.values.year).toBe("26");
  });
});

describe("demoEmailFromEnv (#679)", () => {
  it("defaults to the demo dispatcher", () => {
    expect(demoEmailFromEnv({})).toBe(DEMO_EMAIL);
    expect(demoEmailFromEnv({ DEMO_EMAIL: "" })).toBe(DEMO_EMAIL);
  });

  it("takes another seeded demo account, lowercased and trimmed", () => {
    expect(demoEmailFromEnv({ DEMO_EMAIL: " Admin@Example.test " })).toBe("admin@example.test");
  });

  it("refuses anything outside the synthetic example.test demo accounts", () => {
    for (const email of [
      "admin@birchdesignlab.com",
      "someone@example.test.evil.com",
      "not-an-email",
    ])
      expect(() => demoEmailFromEnv({ DEMO_EMAIL: email })).toThrow(
        "demo-seed: DEMO_EMAIL must be a seeded demo account (@example.test)",
      );
  });
});

describe("passwordFromEnv (#679)", () => {
  it("prefers DEMO_PASSWORD, still accepts DEMO_DISPATCHER_PASSWORD", () => {
    expect(passwordFromEnv({ DEMO_PASSWORD: "a", DEMO_DISPATCHER_PASSWORD: "b" }, DEMO_EMAIL)).toBe(
      "a",
    );
    expect(passwordFromEnv({ DEMO_DISPATCHER_PASSWORD: "b" }, DEMO_EMAIL)).toBe("b");
  });

  it("names DEMO_PASSWORD when neither a password nor the secret file is set", () => {
    expect(() => passwordFromEnv({}, "admin@example.test")).toThrow(
      "demo-seed: set DEMO_PASSWORD or SEED_PASSWORD_SECRET_FILE",
    );
  });
});

describe("runDemoSeed", () => {
  it("signs in as the account it is given (#679)", async () => {
    const { calls, fetchFn } = fakeServer({});
    await runDemoSeed({
      origin: ORIGIN,
      email: "admin@example.test",
      password: "pw",
      fetchFn,
      sleepFn: noSleep,
      log: vi.fn(),
      settleTimeoutMs: 1000,
    });
    expect(calls[0]?.body).toEqual({ email: "admin@example.test", password: "pw" });
  });

  it("signs in as the demo dispatcher, then submits each story once through the public API", async () => {
    const { calls, fetchFn } = fakeServer({});
    const log = vi.fn();
    const result = await runDemoSeed({
      origin: ORIGIN,
      password: "pw-not-logged",
      fetchFn,
      sleepFn: noSleep,
      log,
      settleTimeoutMs: 1000,
    });
    expect(result.submitted).toBe(DEMO_STORIES.length);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/auth/sign-in/email",
      body: { email: DEMO_EMAIL, password: "pw-not-logged" },
    });
    expect(calls[0]?.headers.origin).toBe(ORIGIN);
    const posts = calls.filter((c) => c.method === "POST" && c.path === "/api/v1/queries");
    expect(posts).toHaveLength(DEMO_STORIES.length);
    expect(posts.map((p) => (p.body as { queryType: string }).queryType)).toEqual(
      DEMO_STORIES.map((s) => s.queryType),
    );
    for (const post of posts) {
      expect(post.body).toMatchObject({ configHash: HASH, mode: "normal" });
      expect(post.headers["x-requested-with"]).toBe("querymodule");
      expect(post.headers.cookie).toBe("__Host-qm_session=abc123");
      expect(post.headers["idempotency-key"]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    }
    expect(new Set(posts.map((p) => p.headers["idempotency-key"])).size).toBe(posts.length);
    // Nothing but sign-in, config, list and submit: no deletes, no other verbs.
    expect(calls.every((c) => c.method === "GET" || c.method === "POST")).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain("pw-not-logged");
  });

  it("refuses when the dispatcher already has requests and submits nothing", async () => {
    const { calls, fetchFn } = fakeServer({ existing: 1 });
    await expect(
      runDemoSeed({ origin: ORIGIN, password: "pw", fetchFn, sleepFn: noSleep, log: vi.fn() }),
    ).rejects.toBeInstanceOf(DemoSeedRefusedError);
    expect(calls.filter((c) => c.method === "POST" && c.path === "/api/v1/queries")).toHaveLength(
      0,
    );
  });

  it("a failed sign-in is fixed text: no password, no response body", async () => {
    const { fetchFn } = fakeServer({ signIn: 401 });
    const err = await runDemoSeed({
      origin: ORIGIN,
      password: "pw-secret-value",
      fetchFn,
      sleepFn: noSleep,
      log: vi.fn(),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toContain("sign-in failed (HTTP 401)");
    expect(String((err as Error).message)).not.toContain("pw-secret-value");
  });

  it("a rejected submit stops the run and names the story and the status, never the values", async () => {
    const { fetchFn } = fakeServer({ submit: 400 });
    const err = await runDemoSeed({
      origin: ORIGIN,
      password: "pw",
      fetchFn,
      sleepFn: noSleep,
      log: vi.fn(),
    }).catch((e: unknown) => e);
    const first = DEMO_STORIES[0];
    expect(String((err as Error).message)).toBe(`demo-seed: ${first?.id} was rejected (HTTP 400)`);
  });

  it("waits for the sources to settle, up to the timeout, and reports what is still pending", async () => {
    const { fetchFn } = fakeServer({ settleAfterPolls: 1000 });
    let now = 0;
    const result = await runDemoSeed({
      origin: ORIGIN,
      password: "pw",
      fetchFn,
      sleepFn: async (ms) => {
        now += ms;
      },
      nowFn: () => now,
      log: vi.fn(),
      settleTimeoutMs: 5000,
    });
    expect(result.settled).toBe(false);
    expect(result.submitted).toBe(DEMO_STORIES.length);
  });
});
