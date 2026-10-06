// packages/api/test/security/log-capture.test.ts
import { inspect } from "node:util";
import {
  AdminUserListSchema,
  AdminUserSessionListSchema,
  CreateUserResponseSchema,
  SubmitQueryResponseSchema,
} from "@querymodule/core/contracts";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { Credentials, SourceAdapter } from "../../src/adapters/types";
import { sessionCookieName, toBetterAuthLogger } from "../../src/auth/auth";
import { Secret } from "../../src/credentials/secret";
import { auditEvent, sourceResult } from "../../src/db/schema";
import type { RequestDeks } from "../../src/keys/request-keys";
import { createLogger } from "../../src/log/logger";
import { grantRole } from "../../src/ops/grant-role";
import { ALL_ON, API, adminConfigApp, withSiteConfig } from "../helpers/admin-config";
import { TEST_SECRETS } from "../helpers/fixture";
import { manualTime } from "../helpers/manual-time";
import { createTestApp, startTestServer, type TestApp } from "../helpers/test-app";

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

/** Every audit row's details as one string, to show a value reached no audit sink either. */
async function auditText(t: TestApp): Promise<string> {
  const r = await t.deps.db.$client.execute("SELECT type, details FROM audit_event ORDER BY id");
  return JSON.stringify(r.rows);
}

describe("SEC-010 SEC-014 log capture: admin routes (Task 29, spec 5.9)", () => {
  it("config publish: the changed pointer is audited, the document value reaches no sink", async () => {
    const mark = "ZZLOGCANARYAGENCY";
    const a = await adminConfigApp();
    const doc = withSiteConfig(await a.exportVersion(1), (s) => {
      s.defaults = { ...(s.defaults as Record<string, string>), agency: mark };
    });
    const put = await a.call("implementer", "PUT", `${API}/draft`, {
      baseVersion: 1,
      document: doc,
    });
    expect(put.status).toBe(200);
    expect((await a.call("implementer", "POST", `${API}/validate`, { document: doc })).status).toBe(
      200,
    );
    expect(
      (await a.call("implementer", "POST", `${API}/publish`, { draftVersion: 2 })).status,
    ).toBe(200);
    expect(a.t.deps.config.current().siteConfig.defaults.agency).toBe(mark);

    const published = await a.t.auditRows("configPublished");
    expect(published).toHaveLength(1);
    expect(published[0]?.details.changedPointers).toEqual(["/siteConfig/defaults/agency"]);
    const sinks = [...a.t.logLines, ...stray].join("\n");
    expect(a.t.logLines.length).toBeGreaterThan(0);
    expect(sinks.includes(mark), "document value in a log line").toBe(false);
    expect((await auditText(a.t)).includes(mark), "document value in an audit row").toBe(false);
  });

  it("user create: the temporary password is in the create response only, in no sink", async () => {
    const a = await adminConfigApp();
    const r = await a.call("admin", "POST", "/api/v1/admin/users", {
      email: "fresh@example.test",
      name: "Fresh",
      role: "user",
    });
    expect(r.status).toBe(201);
    const { user, temporaryPassword } = CreateUserResponseSchema.parse(await r.json());
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
    // The temporary password flows through sign-in, a refused data route and change-password.
    await a.t.signIn("fresh@example.test", `${temporaryPassword}x`);
    const cookie = await a.t.cookieFor("fresh@example.test", temporaryPassword);
    expect((await a.t.request("/api/v1/config", { headers: { cookie } })).status).toBe(403);
    const changed = await a.t.request("/api/v1/auth/change-password", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-requested-with": "querymodule" },
      body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: PW }),
    });
    expect(changed.status).toBe(200);
    const list = await (await a.call("admin", "GET", "/api/v1/admin/users")).text();
    const sessions = await (
      await a.call("admin", "GET", `/api/v1/admin/users/${user.id}/sessions`)
    ).text();

    const sinks = [...a.t.logLines, ...stray].join("\n");
    expect(a.t.logLines.length).toBeGreaterThan(0);
    expect(sinks.includes(temporaryPassword), "temporary password in a log line").toBe(false);
    expect((await auditText(a.t)).includes(temporaryPassword), "in an audit row").toBe(false);
    expect(`${list}${sessions}`.includes(temporaryPassword), "in a later response").toBe(false);
  });

  it("sign-in stats: the client IP is counted, never shown in a response or a log line", async () => {
    // Production trusts CF-Connecting-IP (cloudflared ingress), so the audit records this value.
    const ip = "203.0.113.77";
    const t = await createTestApp({ env: { NODE_ENV: "production", SITE_CONFIG: ALL_ON } });
    const adminId = await t.createUser("admin@example.test", PW);
    await grantRole(t.deps, { email: "admin@example.test", role: "admin", change: "granted" });
    const userId = await t.createUser("dispatcher@example.test", PW);
    await t.signIn("dispatcher@example.test", WRONG, { "cf-connecting-ip": ip });
    expect((await t.signIn("dispatcher@example.test", PW, { "cf-connecting-ip": ip })).status).toBe(
      200,
    );
    const signed = await t.signIn("admin@example.test", PW, { "cf-connecting-ip": ip });
    const cookie = signed.headers
      .getSetCookie()
      .map((c) => c.split(";")[0] ?? "")
      .find((c) => c.startsWith(`${sessionCookieName(t.env)}=`));
    expect(cookie).toBeDefined();
    const get = (path: string) =>
      t.request(path, {
        headers: {
          cookie: cookie ?? "",
          "x-requested-with": "querymodule",
          "cf-connecting-ip": ip,
        },
      });
    const listRes = await get("/api/v1/admin/users");
    expect(listRes.status).toBe(200);
    const listText = await listRes.text();
    const users = AdminUserListSchema.parse(JSON.parse(listText)).users;
    expect(users.find((u) => u.id === userId)).toMatchObject({ signInCount: 1, distinctIps: 1 });
    const sessionsRes = await get(`/api/v1/admin/users/${adminId}/sessions`);
    expect(sessionsRes.status).toBe(200);
    const sessionsText = await sessionsRes.text();
    expect(AdminUserSessionListSchema.parse(JSON.parse(sessionsText)).sessions).toHaveLength(1);
    // The IP is in the audit (the stats source), so its absence below is meaningful.
    expect((await t.auditRows("loginSucceeded"))[0]?.details.clientIp).toBe(ip);

    const sinks = [...t.logLines, ...stray].join("\n");
    expect(t.logLines.length).toBeGreaterThan(0);
    expect(sinks.includes(ip), "IP value in a log line").toBe(false);
    expect(`${listText}${sessionsText}`.includes(ip), "IP value in a response").toBe(false);
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

describe("SEC-006 log capture: a failed query on an unsanitized route (M1 phase review LS-1)", () => {
  /** A BEFORE INSERT trigger that aborts every insert into `table`, so drizzle throws its own error. */
  async function failInserts(t: TestApp, table: "user" | "account"): Promise<void> {
    await t.deps.db.$client.execute(
      `CREATE TRIGGER ls1_fail_${table} BEFORE INSERT ON "${table}" BEGIN SELECT RAISE(ABORT, 'forced'); END`,
    );
  }

  it("POST /admin/users: a failed insert logs no email, name, password hash or query text", async () => {
    const a = await adminConfigApp();
    await a.userId("admin"); // signs the admin in before any insert is made to fail
    const ctx = await a.t.deps.auth.$context;
    const hashSpy = vi.spyOn(ctx.password, "hash");
    const email = "ls1-canary@example.test";
    const name = "ZZLOGCANARYNAME";
    await failInserts(a.t, "account");
    const r1 = await a.call("admin", "POST", "/api/v1/admin/users", { email, name, role: "user" });
    expect(r1.status).toBe(500);
    await a.t.deps.db.$client.execute("DROP TRIGGER ls1_fail_account");
    await failInserts(a.t, "user");
    const r2 = await a.call("admin", "POST", "/api/v1/admin/users", { email, name, role: "user" });
    expect(r2.status).toBe(500);
    const hashes = await Promise.all(hashSpy.mock.results.map((m) => m.value as Promise<string>));
    expect(hashes).toHaveLength(2);

    const sinks = [...a.t.logLines, ...stray].join("\n");
    const unhandled = a.t.logLines.map((l) => JSON.parse(l)).filter((l) => l.msg === "unhandled");
    expect(unhandled).toHaveLength(2);
    // The error's name and a SQLite code walked from its cause are kept: enough to triage.
    // drizzle's DrizzleQueryError keeps the name "Error"; the code comes from its libsql cause.
    for (const u of unhandled)
      expect(u.err).toEqual({ name: "Error", code: expect.stringMatching(/^SQLITE_CONSTRAINT/) });
    for (const f of [email, name, ...hashes, "Failed query", "params:"])
      expect(sinks.includes(f), `leaked: ${f.slice(0, 12)}...`).toBe(false);
  });

  it("PUT /admin/config/draft: a failed insert logs no config document value or query text", async () => {
    const mark = "ZZDRAFTCANARYAGENCY";
    const a = await adminConfigApp();
    await a.userId("implementer"); // signs in before any insert is made to fail
    const doc = withSiteConfig(await a.exportVersion(1), (s) => {
      s.defaults = { ...(s.defaults as Record<string, string>), agency: mark };
    });
    await a.t.deps.db.$client.execute(
      "CREATE TRIGGER ls1_fail_draft BEFORE INSERT ON site_config_version BEGIN SELECT RAISE(ABORT, 'forced'); END",
    );
    const r = await a.call("implementer", "PUT", `${API}/draft`, { baseVersion: 1, document: doc });
    expect(r.status).toBe(500);
    const body = await r.text();

    const sinks = [...a.t.logLines, ...stray].join("\n");
    const unhandled = a.t.logLines.map((l) => JSON.parse(l)).filter((l) => l.msg === "unhandled");
    expect(unhandled).toHaveLength(1);
    expect(unhandled[0]?.err).toEqual({
      name: "Error",
      code: expect.stringMatching(/^SQLITE_CONSTRAINT/),
    });
    for (const f of [mark, "Failed query", "params:"]) {
      expect(sinks.includes(f), `leaked to a log: ${f}`).toBe(false);
      expect(body.includes(f), `leaked to the response: ${f}`).toBe(false);
    }
    expect((await auditText(a.t)).includes(mark), "document value in an audit row").toBe(false);
  });

  it("a query error carrying a session token in its message reaches no sink", async () => {
    const t = await createTestApp();
    const tokenLike = "ZZSESSIONTOKENCANARY0123456789abcdef";
    t.app.get("/api/v1/__dbfail", () => {
      const e = new Error(
        `Failed query: select from "session" where token = ?\nparams: ${tokenLike}`,
      );
      e.name = "DrizzleQueryError";
      throw e;
    });
    expect((await t.request("/api/v1/__dbfail")).status).toBe(500);
    const sinks = [...t.logLines, ...stray].join("\n");
    expect(sinks).toContain("DrizzleQueryError");
    expect(sinks.includes(tokenLike), "token in a log line").toBe(false);
    expect(sinks.includes("Failed query"), "query text in a log line").toBe(false);
  });
});

describe("SEC-006 log capture: an adapter that throws with its request (spec 10.3, 5.9)", () => {
  // Synthetic values only (CLAUDE.md, spec 5.4): the plate is the submitted value, the password a
  // stand-in for a credential an adapter could quote back in its error.
  const PLATE = "ZZ-0001";
  const PASSWORD = "hunter2";

  it("an Error whose message and cause carry the plate and a password reaches no sink", async () => {
    const time = manualTime();
    const t = await createTestApp({
      clock: time.clock,
      timers: time.timers,
      monotonic: time.monotonic,
    });
    await t.createUser("dispatcher@example.test", PW);
    const cookie = await t.cookieFor("dispatcher@example.test", PW);
    const creds = new Secret<Credentials>({ username: "zz-officer-0001", secret: PASSWORD });
    const calls: string[] = [];
    // Every source's adapter echoes its request config in the message and the cause, as a real
    // adapter's HTTP client error can.
    const throwing: SourceAdapter = {
      query: async (req) => {
        calls.push(req.sourceId);
        const config = { plate: PLATE, password: PASSWORD };
        throw new Error(`state system refused ${JSON.stringify(config)}`, {
          cause: { ...config, creds, request: req },
        });
      },
    };
    vi.spyOn(t.deps.adapters, "get").mockReturnValue(throwing);
    const r = await t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        queryType: "VEH",
        values: { plate: PLATE, state: "TX" },
        sourceIds: ["stateSource", "nationalSource"],
        mode: "normal",
        configHash: t.deps.config.current().configHash,
      }),
    });
    expect(r.status).toBe(202);
    const { correlationId } = SubmitQueryResponseSchema.parse(await r.json());
    await time.run(0);
    await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));

    expect(calls.sort()).toEqual(["nationalSource", "stateSource"]);
    // the outcome is the enumerated code, never the adapter's text
    const rows = await t.deps.db
      .select({ status: sourceResult.status, errorCode: sourceResult.errorCode })
      .from(sourceResult)
      .where(eq(sourceResult.correlationId, correlationId));
    expect(rows).toEqual([
      { status: "failed", errorCode: "failed" },
      { status: "failed", errorCode: "failed" },
    ]);
    const responded = await t.deps.db
      .select({ details: auditEvent.details })
      .from(auditEvent)
      .where(
        and(eq(auditEvent.correlationId, correlationId), eq(auditEvent.type, "sourceResponded")),
      );
    expect(responded).toHaveLength(2);
    for (const a of responded) expect(a.details).toMatchObject({ errorCode: "failed" });
    expect(t.fatals).toEqual([]);

    const sinks = [...t.logLines, ...stray].join("\n");
    expect(t.logLines.length).toBeGreaterThan(0);
    const audit = JSON.stringify(responded);
    for (const f of [PLATE, PASSWORD, "state system refused"]) {
      expect(sinks.includes(f), `leaked to a log: ${f}`).toBe(false);
      expect(audit.includes(f), `leaked to sourceResponded: ${f}`).toBe(false);
    }
  });

  it("a Secret reaches no sink through the app logger, JSON.stringify, String() or util.inspect", async () => {
    const t = await createTestApp();
    const creds = new Secret<Credentials>({ username: "zz-officer-0001", secret: PASSWORD });
    const bare = new Secret(PASSWORD);
    // field keys the logger does not redact by name, so only Secret keeps the value out
    t.deps.logger.error("adapter request", { request: { sourceId: "stateSource", login: creds } });
    t.deps.logger.warn("adapter login", { login: bare, nested: [{ token2: bare }] });
    t.deps.logger.info(`adapter login ${JSON.stringify({ login: creds })} ${String(bare)}`);
    t.deps.logger.error("adapter failed", {
      error: new Error(`login ${String(creds)}`, { cause: { login: creds } }),
    });
    console.error("adapter", creds, inspect({ login: bare }, { showHidden: true, depth: 10 }));

    const sinks = [...t.logLines, ...stray].join("\n");
    expect(t.logLines.length).toBeGreaterThanOrEqual(4);
    expect(stray.length).toBeGreaterThan(0);
    expect(sinks.includes(PASSWORD), "Secret value in a sink").toBe(false);
    expect(sinks).toContain("[secret]");
  });
});
