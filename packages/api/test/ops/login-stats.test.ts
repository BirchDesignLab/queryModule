import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { withTransaction } from "../../src/db/tx";
import { uuidv7 } from "../../src/ids";
import { formatLoginStats, loginStats, parseLoginStatsArgs } from "../../src/ops/login-stats";
import { createTestApp, type TestApp } from "../helpers/test-app";

const PW = "correct horse battery staple 1";

/** Records one loginSucceeded and returns its stored `at` (the test clock still moves with real time). */
async function signedIn(
  t: TestApp,
  userId: string,
  email: string,
  clientIp: string,
): Promise<number> {
  await withTransaction(t.deps.db, (tx) =>
    t.deps.audit.record(tx, {
      type: "loginSucceeded",
      actor: { id: userId, email, role: "user" },
      identitySource: "local",
      details: { method: "password", sessionId: uuidv7(), clientIp },
    }),
  );
  const r = await t.deps.db.$client.execute("SELECT at FROM audit_event ORDER BY id DESC LIMIT 1");
  return Number(r.rows[0]?.at);
}

describe("SEC-010 login stats", () => {
  it("counts sign-ins, distinct client IPs and the last sign-in per account, from loginSucceeded only", async () => {
    const t = await createTestApp();
    const a = await t.createUser("dispatcher@example.test", PW);
    const b = await t.createUser("officer@example.test", PW);
    await t.createUser("records@example.test", PW);

    await signedIn(t, a, "dispatcher@example.test", "198.51.100.7");
    t.clock.advance(60_000);
    await signedIn(t, a, "dispatcher@example.test", "198.51.100.7");
    t.clock.advance(60_000);
    const lastA = await signedIn(t, a, "dispatcher@example.test", "203.0.113.9");
    t.clock.advance(60_000);
    const lastB = await signedIn(t, b, "officer@example.test", "203.0.113.9");
    await withTransaction(t.deps.db, (tx) =>
      t.deps.audit.record(tx, {
        type: "loginFailed",
        actor: SYSTEM_ACTOR,
        identitySource: "system",
        details: { targetUserId: a, reason: "badPassword", clientIp: "192.0.2.1" },
      }),
    );

    const rows = await loginStats(t.deps.db);
    expect(rows).toEqual([
      { email: "dispatcher@example.test", signIns: 3, distinctIps: 2, lastSignIn: lastA },
      { email: "officer@example.test", signIns: 1, distinctIps: 1, lastSignIn: lastB },
      { email: "records@example.test", signIns: 0, distinctIps: 0, lastSignIn: null },
    ]);
  });

  it("counts only sign-ins at or after --since", async () => {
    const t = await createTestApp();
    const a = await t.createUser("dispatcher@example.test", PW);
    const first = await signedIn(t, a, "dispatcher@example.test", "198.51.100.7");
    t.clock.advance(60_000);
    const second = await signedIn(t, a, "dispatcher@example.test", "203.0.113.9");
    expect(await loginStats(t.deps.db, first + 1)).toEqual([
      { email: "dispatcher@example.test", signIns: 1, distinctIps: 1, lastSignIn: second },
    ]);
  });

  it("prints one line per account and never prints a client IP", () => {
    const text = formatLoginStats([
      {
        email: "dispatcher@example.test",
        signIns: 3,
        distinctIps: 2,
        lastSignIn: Date.UTC(2026, 9, 1, 14, 0),
      },
      { email: "records@example.test", signIns: 0, distinctIps: 0, lastSignIn: null },
    ]);
    expect(text).toBe(
      [
        "account\tsign-ins\tdistinct IPs\tlast sign-in (UTC)",
        "dispatcher@example.test\t3\t2\t2026-10-01T14:00:00Z",
        "records@example.test\t0\t0\tnever",
        "",
      ].join("\n"),
    );
    expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe("parseLoginStatsArgs", () => {
  it("takes no arguments or --since <YYYY-MM-DD> (UTC midnight)", () => {
    expect(parseLoginStatsArgs([])).toEqual({ since: undefined });
    expect(parseLoginStatsArgs(["--since", "2026-10-01"])).toEqual({ since: Date.UTC(2026, 9, 1) });
  });

  it.each([
    [["--since"]],
    [["--since", "yesterday"]],
    [["--since", "2026-13-01"]],
    [["--since=2026-10-01"]],
    [["--json"]],
  ])("rejects %j with a usage error", (argv) => {
    expect(() => parseLoginStatsArgs(argv)).toThrow(/usage: login-stats/);
  });
});
