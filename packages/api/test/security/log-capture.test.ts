// packages/api/test/security/log-capture.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { TEST_SECRETS } from "../helpers/fixture";
import { createTestApp, startTestServer } from "../helpers/test-app";

const PW = "correct-horse-battery-1";
const WRONG = "wrong-password-zz9-plural";
let stray: string[] = [];
beforeEach(() => {
  stray = [];
  const cap = (s: unknown) => {
    stray.push(String(s));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(cap as never);
  vi.spyOn(process.stderr, "write").mockImplementation(cap as never);
  for (const m of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      stray.push(a.map(String).join(" "));
    });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("SEC-006 log capture", () => {
  it("no key material, secret, password or session token reaches any sink", async () => {
    const t = await createTestApp();
    t.app.get("/api/v1/__boom", () => {
      throw new Error(
        `boom ${TEST_SECRETS.dbEncryptionKey} ${TEST_SECRETS.credentialKey.toString("base64")}`,
      );
    });
    await t.createUser("dispatcher@example.test", PW);
    await t.signIn("dispatcher@example.test", WRONG);
    const signed = await t.signIn("dispatcher@example.test", PW);
    const token = signed.headers.get("set-auth-token") ?? "";
    const cookie = await t.cookieFor("dispatcher@example.test", PW);
    await t.request("/api/v1/config", { headers: { cookie } });
    await t.request("/api/v1/__boom");
    const s = await startTestServer(t);
    const ws = new WebSocket(s.wsUrl, { headers: { origin: "http://localhost:3000", cookie } });
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ v: 1, type: "ping", nonce: "n" }));
    await new Promise((r) => ws.once("message", r));
    ws.close();
    await t.request("/api/v1/auth/sign-out", { method: "POST", headers: { cookie } });
    await s.close();

    const all = [...t.logLines, ...stray].join("\n");
    expect(t.logLines.length).toBeGreaterThan(5);
    // `token` is expected to be "" here: stripWebBearerToken (SEC-005) removes set-auth-token
    // whenever the request carries an Origin header, which every request through this test
    // harness does. `String.prototype.includes("")` is trivially true, so an empty forbidden
    // value would fail the assertion regardless of what actually reached a sink; it is filtered
    // out rather than asserted on.
    const forbidden = [
      TEST_SECRETS.dbEncryptionKey,
      TEST_SECRETS.credentialKey.toString("base64"),
      TEST_SECRETS.credentialKey.toString("hex"),
      TEST_SECRETS.dataKey.toString("base64"),
      TEST_SECRETS.dataKey.toString("hex"),
      TEST_SECRETS.betterAuthSecret,
      TEST_SECRETS.seedPasswordSecret ?? "unset-seed",
      PW,
      WRONG,
      token,
      cookie.split("=")[1] ?? "unset-cookie",
    ].filter((f) => f.length > 0);
    for (const f of forbidden) expect(all.includes(f), `leaked: ${f.slice(0, 6)}...`).toBe(false);
  });
});
