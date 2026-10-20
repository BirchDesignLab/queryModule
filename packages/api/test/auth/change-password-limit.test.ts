import { describe, expect, it } from "vitest";
import { errorOf } from "../helpers/admin-config";
import { createTestApp } from "../helpers/test-app";

/*
 * D-M2P3-3 (SEC-005, SEC-020): change-password counts wrong current passwords per account.
 * 5 wrong in 15 minutes, then 429 rateLimited with Retry-After on change-password only.
 * No account lockout, no audit row for a wrong guess or the block.
 */

const PW = "correct-horse-battery-1";
const NEW_PW = "a-brand-new-password-9";
const WRONG = "definitely-not-the-password-1";
const MIN = 60_000;
const H = { "x-requested-with": "querymodule", "content-type": "application/json" };

async function setup() {
  const t = await createTestApp();
  await t.createUser("one@example.test", PW);
  await t.createUser("two@example.test", PW);
  const one = await t.cookieFor("one@example.test", PW);
  const two = await t.cookieFor("two@example.test", PW);
  const change = (cookie: string, currentPassword: string, newPassword = NEW_PW) =>
    t.request("/api/v1/auth/change-password", {
      method: "POST",
      headers: { ...H, cookie },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  return { t, one, two, change };
}

describe("change-password per-account limit (D-M2P3-3)", () => {
  it("answers 429 with Retry-After on the sixth call after five wrong passwords, even with the right one", async () => {
    const { one, change } = await setup();
    for (let i = 0; i < 5; i++) expect((await change(one, WRONG)).status).toBe(400);
    const blocked = await change(one, PW);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await errorOf(blocked)).code).toBe("rateLimited");
  });

  it("accepts the right password once the window passes", async () => {
    const { t, one, change } = await setup();
    for (let i = 0; i < 5; i++) await change(one, WRONG);
    expect((await change(one, PW)).status).toBe(429);
    t.clock.advance(15 * MIN + 1000);
    expect((await change(one, PW)).status).toBe(200);
  });

  it("leaves sign-in and other users unaffected", async () => {
    const { t, one, two, change } = await setup();
    for (let i = 0; i < 5; i++) await change(one, WRONG);
    expect((await change(one, PW)).status).toBe(429);
    expect((await t.signIn("one@example.test", PW)).status).toBe(200);
    expect((await change(two, PW)).status).toBe(200);
  });

  it("a success clears the count", async () => {
    const { one, change } = await setup();
    for (let i = 0; i < 4; i++) expect((await change(one, WRONG)).status).toBe(400);
    expect((await change(one, PW, NEW_PW)).status).toBe(200);
    for (let i = 0; i < 4; i++)
      expect((await change(one, WRONG, "another-new-password-7")).status).toBe(400);
    expect((await change(one, NEW_PW, "another-new-password-7")).status).toBe(200);
  });

  it("writes no audit row for a wrong guess or the block, and logs no password", async () => {
    const { t, one, change } = await setup();
    for (let i = 0; i < 6; i++) await change(one, WRONG);
    expect(await t.auditRows("passwordChanged")).toHaveLength(0);
    const logs = t.logLines.join("\n");
    for (const secret of [PW, NEW_PW, WRONG]) expect(logs).not.toContain(secret);
  });
});
