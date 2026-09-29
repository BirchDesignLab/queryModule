// packages/api/test/security/log-capture.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { toBetterAuthLogger } from "../../src/auth/auth";
import type { RequestDeks } from "../../src/keys/request-keys";
import { createLogger } from "../../src/log/logger";
import { TEST_SECRETS } from "../helpers/fixture";
import { createTestApp, startTestServer } from "../helpers/test-app";

// A pass-through spy on createRequestKeys: T1 zeroes the DEKs when it finishes, so the bytes
// are copied here as they are made, for the submit case below to look for in every sink.
const dekCopies = vi.hoisted((): RequestDeks[] => []);
vi.mock("../../src/keys/request-keys", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../src/keys/request-keys")>();
  return {
    ...m,
    createRequestKeys: (...args: Parameters<typeof m.createRequestKeys>) => {
      const out = m.createRequestKeys(...args);
      dekCopies.push({
        values: Buffer.from(out.deks.values),
        payload: Buffer.from(out.deks.payload),
      });
      return out;
    },
  };
});

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
    await t.request("/api/v1/auth/sign-out", {
      method: "POST",
      headers: { cookie, "x-requested-with": "querymodule" },
    });
    await s.close();

    const all = [...t.logLines, ...stray].join("\n");
    expect(t.logLines.length).toBeGreaterThan(5);
    // `token` is expected to be "" here: stripWebBearerToken (SEC-005) removes set-auth-token
    // whenever the request carries an Origin header, which every request through this test
    // harness does. `String.prototype.includes("")` is trivially true, so an empty forbidden
    // value would fail the assertion regardless of what actually reached a sink; it is filtered
    // out rather than asserted on.
    // The cookie header carries `<name>=<encodeURIComponent(token + "." + signature)>`. Checking
    // only that encoded string (critic finding C2) would miss a leak of the decoded
    // `token.signature` form or of the raw session token alone, since neither contains the
    // percent-escapes the encoded form does. Both are checked too, each asserted non-trivial in
    // length so an empty/absent value can't slip past the filter below.
    const encodedCookieValue = cookie.split("=").slice(1).join("=");
    const decodedCookieValue = decodeURIComponent(encodedCookieValue);
    const rawSessionToken = decodedCookieValue.split(".")[0] ?? "";
    expect(decodedCookieValue.length).toBeGreaterThanOrEqual(16);
    expect(rawSessionToken.length).toBeGreaterThanOrEqual(16);
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
      decodedCookieValue,
      rawSessionToken,
    ].filter((f) => f.length > 0);
    for (const f of forbidden) expect(all.includes(f), `leaked: ${f.slice(0, 6)}...`).toBe(false);
  });
});

describe("SEC-006 log capture: POST /api/v1/queries (M1 P2 submit case)", () => {
  it("no submitted value, DEK byte or DATA_KEY reaches any sink", async () => {
    dekCopies.length = 0;
    const t = await createTestApp();
    await t.createUser("dispatcher@example.test", PW);
    const cookie = await t.cookieFor("dispatcher@example.test", PW);
    const { configHash } = (await (
      await t.request("/api/v1/config", { headers: { cookie } })
    ).json()) as { configHash: string };
    const post = (body: Record<string, unknown>) =>
      t.request("/api/v1/queries", {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-requested-with": "querymodule",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
    const sourceIds = ["stateSource", "nationalSource"];
    const veh = await post({
      queryType: "VEH",
      values: { plate: "ZZ-0001" },
      sourceIds,
      mode: "plateOnly",
      configHash,
    });
    expect(veh.status).toBe(202);
    const per = await post({
      queryType: "PER",
      values: { last: "Testerson", dob: "01011901" },
      sourceIds,
      mode: "normal",
      configHash,
    });
    expect(per.status).toBe(202);
    // rejected: posted mode differs from the server's, so the 400 path sees the values too
    const rejected = await post({
      queryType: "PER",
      values: { last: "Testerson", dob: "01011901" },
      sourceIds,
      mode: "plateOnly",
      configHash,
    });
    expect(rejected.status).toBe(400);

    expect(dekCopies).toHaveLength(2);
    const all = [...t.logLines, ...stray].join("\n");
    expect(t.logLines.length).toBeGreaterThan(0);
    const forbidden = [
      "ZZ-0001",
      "Testerson",
      "TESTERSON",
      "01011901",
      "1901-01-01",
      TEST_SECRETS.dataKey.toString("base64"),
      TEST_SECRETS.dataKey.toString("hex"),
      ...dekCopies.flatMap((d) =>
        [d.values, d.payload].flatMap((b) => [b.toString("base64"), b.toString("hex")]),
      ),
    ];
    for (const f of forbidden) expect(all.includes(f), `leaked: ${f.slice(0, 6)}...`).toBe(false);
  });
});

describe("toBetterAuthLogger (A3 T14 CV2)", () => {
  // Better Auth's own default log level is "warn" (@better-auth/core/env createLogger), and none
  // of the scenarios in the log-capture test above happen to make it emit a warn/error line, so
  // that test cannot observe whether this adapter is wired in or what it does (spec:S1,
  // critic:C1). These tests drive `toBetterAuthLogger` directly instead.
  it("routes warn/error/success through the app logger, mapping success to info, and scrubs a secret value carried in an arg", () => {
    const lines: string[] = [];
    const secret = TEST_SECRETS.dbEncryptionKey;
    const logger = createLogger({ sink: (l) => lines.push(l), secretValues: [secret] });
    const bal = toBetterAuthLogger(logger);

    bal.log("warn", "warn message");
    bal.log("success", "ok message");
    bal.log("error", "error message", `carries ${secret} inline`);

    const parsed = lines.map((l) => JSON.parse(l) as { level: string; msg: string });
    expect(parsed.some((p) => p.level === "warn" && p.msg === "warn message")).toBe(true);
    // Better Auth's own "success" level has no app-logger counterpart; it maps to "info".
    expect(parsed.some((p) => p.level === "info" && p.msg === "ok message")).toBe(true);
    expect(parsed.some((p) => p.level === "error")).toBe(true);

    const all = lines.join("\n");
    expect(all).not.toContain(secret);
    expect(all).toContain("[redacted]");
    // The positional arg is wrapped under "args", not spliced into the top-level fields.
    expect(all).toContain('"args"');
  });

  it("reduces an Error arg to { errorName } so a Drizzle-style message carrying a token never reaches the sink (critic:CV1)", () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (l) => lines.push(l) });
    const bal = toBetterAuthLogger(logger);
    const tokenLike = "sess_tok_abcdefghijklmnopqrstuvwxyz012345";

    bal.log(
      "error",
      "INTERNAL_SERVER_ERROR",
      new Error(`Failed query: insert into session ... params: ${tokenLike}`),
    );

    const all = lines.join("\n");
    expect(all).not.toContain(tokenLike);
    expect(all).not.toContain("Failed query");
    expect(all).toContain("errorName");
    expect(all).toContain("Error");
  });

  it("does not throw and never leaks a token-like value when message itself is the raw Error, with no extra args (re-review r1:CV1-message-gap)", () => {
    // Mirrors `better-auth` dist `api/routes/session.mjs:370`
    // (`catch (e) { ctx.context.logger.error(e); }`), the `/list-sessions` endpoint: a single
    // positional argument, so Better Auth's own `(...[message, ...args]) =>
    // LogFunc(level, message, args)` destructure makes the Error the `message` parameter itself,
    // not an `args` entry. `deps.ts` always builds a non-empty `secretValues`, so `createLogger`
    // here is given one too, matching every real deployment and test harness.
    const lines: string[] = [];
    const logger = createLogger({
      sink: (l) => lines.push(l),
      secretValues: [TEST_SECRETS.dbEncryptionKey],
    });
    const bal = toBetterAuthLogger(logger);
    const tokenLike = "sess_tok_abcdefghijklmnopqrstuvwxyz012345";

    expect(() => {
      bal.log("error", new Error(`Failed query: insert into session ... params: ${tokenLike}`));
    }).not.toThrow();

    const parsed = JSON.parse(lines[0] ?? "{}") as { msg?: string };
    const all = lines.join("\n");
    expect(all).not.toContain(tokenLike);
    expect(all).not.toContain("Failed query");
    // `message` was the raw Error itself (no separate `args` entry to carry an errorName field
    // under); reduced to its name, so the sink's message text is just "Error".
    expect(parsed.msg).toBe("Error");
  });

  it("replaces a string message carrying a Drizzle 'Failed query ... params:' text with a fixed 'database error' (wave review G-G-m1)", () => {
    // Better Auth 1.7.6 dist/api/index.mjs:206-208 logs `ctx.logger.error(e.message)` for an
    // uncaught error whose message mentions a table/column/relation, so a DrizzleQueryError's
    // message arrives here as the *string* message, with its params (user id, email, token).
    const lines: string[] = [];
    const logger = createLogger({
      sink: (l) => lines.push(l),
      secretValues: [TEST_SECRETS.dbEncryptionKey],
    });
    const bal = toBetterAuthLogger(logger);
    const tokenLike = "sess_tok_abcdefghijklmnopqrstuvwxyz012345";
    const email = "tester-table@example.test";

    bal.log(
      "error",
      `Failed query: insert into "session" ("token", "user_agent") values (?, ?)\nparams: ${tokenLike},${email}`,
    );
    bal.log("error", `something about table x\nparams: ${tokenLike}`);

    const parsed = lines.map((l) => JSON.parse(l) as { msg?: string });
    const all = lines.join("\n");
    expect(all).not.toContain(tokenLike);
    expect(all).not.toContain(email);
    expect(all).not.toContain("Failed query");
    expect(parsed.map((p) => p.msg)).toEqual(["database error", "database error"]);
  });

  it("maps a plain object with a string name (e.g. a user record) to its typeof, never to errorName (wave review G-G-m2)", () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (l) => lines.push(l) });
    const bal = toBetterAuthLogger(logger);
    const displayName = "Casey Placeholder-Name";

    bal.log("warn", "user lookup", { id: "u1", name: displayName, email: "c@example.test" });
    bal.log("warn", { id: "u1", name: displayName });

    const all = lines.join("\n");
    expect(all).not.toContain(displayName);
    expect(all).not.toContain("errorName");
    const parsed = lines.map((l) => JSON.parse(l) as { msg?: string; args?: unknown[] });
    expect(parsed[0]?.args).toEqual(["object"]);
    expect(parsed[1]?.msg).toBe("object");
  });

  it("still maps an error-shaped non-Error object (string name plus message) to errorName (wave review G-G-m2)", () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (l) => lines.push(l) });
    const bal = toBetterAuthLogger(logger);

    bal.log("error", "x", { name: "DrizzleQueryError", message: "Failed query: params: secret" });

    const all = lines.join("\n");
    expect(all).toContain("DrizzleQueryError");
    expect(all).not.toContain("Failed query");
  });
});
