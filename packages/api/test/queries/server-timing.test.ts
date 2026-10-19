import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { MonotonicClock } from "../../src/clock";
import type { AppEnv } from "../../src/http/types";
import { admitSubmit } from "../../src/queries/admission";
import { createTestApp, type TestApp } from "../helpers/test-app";

const PASSWORD = "correct-horse-battery-1";
const EMAIL = "dispatcher@example.test";

/** A monotonic clock that stands still unless a test advances it. */
function fakeMonotonic(): MonotonicClock & { advance: (ms: number) => void } {
  let now = 1000;
  return {
    nowMs: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}

/**
 * The assembled app on a fake monotonic clock: once `slow` is on, the session check takes 30 ms
 * and T1 takes 20 ms more after its acknowledged audit row is written.
 */
async function setup() {
  const mono = fakeMonotonic();
  const t: TestApp = await createTestApp({ monotonic: mono });
  await t.createUser(EMAIL, PASSWORD);
  const cookie = await t.cookieFor(EMAIL, PASSWORD);
  const cfg = (await (await t.request("/api/v1/config", { headers: { cookie } })).json()) as {
    configHash: string;
  };
  const slow = { on: false };
  const resolveGated = t.deps.identity.resolveGated.bind(t.deps.identity);
  vi.spyOn(t.deps.identity, "resolveGated").mockImplementation(async (req) => {
    const r = await resolveGated(req);
    if (slow.on) mono.advance(30);
    return r;
  });
  const record = t.deps.audit.record.bind(t.deps.audit);
  vi.spyOn(t.deps.audit, "record").mockImplementation(async (tx, event) => {
    const r = await record(tx, event);
    if (slow.on && event.type === "acknowledged") mono.advance(20);
    return r;
  });
  const post = (key: string, rawBody?: string) =>
    t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": key,
      },
      body:
        rawBody ??
        JSON.stringify({
          queryType: "VEH",
          values: { plate: "ZZ-0001" },
          sourceIds: ["stateSource", "nationalSource"],
          mode: "plateOnly",
          configHash: cfg.configHash,
        }),
    });
  return { t, mono, slow, post };
}

describe("NFR-004 Server-Timing on the 202 (spec 11, #719)", () => {
  it("measures the 202 from request receipt to after T1 commits", async () => {
    const { t, slow, post } = await setup();
    slow.on = true;
    const r = await post(crypto.randomUUID());
    expect(r.status).toBe(202);
    const [ack] = await t.auditRows("acknowledged");
    // the audit write sits inside T1, so the row cannot include T1's last 20 ms or its COMMIT
    expect(ack?.details.ackLatencyMs as number).toBeGreaterThanOrEqual(30);
    expect(r.headers.get("server-timing")).toBe('ack;dur=50.0;desc="receipt to commit"');
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("puts the header on an idempotent replay of the 202", async () => {
    const { mono, post } = await setup();
    const key = crypto.randomUUID();
    expect((await post(key)).status).toBe(202);
    mono.advance(5);
    const replay = await post(key);
    expect(replay.status).toBe(202);
    expect(replay.headers.get("server-timing")).toBe('ack;dur=0.0;desc="receipt to commit"');
  });

  it("puts no Server-Timing on an error response", async () => {
    const { post } = await setup();
    const r = await post(crypto.randomUUID(), "{not json");
    expect(r.status).toBe(400);
    expect(r.headers.get("server-timing")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("fails a submit mounted without the receipt mark closed, never a 0 ms span", async () => {
    const t = await createTestApp();
    const sub = new Hono<AppEnv>();
    sub.post("/", async (c) => {
      await admitSubmit(c, t.deps);
      return c.text("admitted");
    });
    // Mount before the first request: Hono builds its matcher on first match.
    t.app.route("/api/v1/unmarked-stub", sub);
    const r = await t.request("/api/v1/unmarked-stub", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "querymodule" },
      body: "{}",
    });
    expect(r.status).toBe(500);
    expect(r.headers.get("server-timing")).toBeNull();
  });
});
