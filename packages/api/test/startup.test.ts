import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CORE_VERSION } from "@querymodule/core/contracts";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type * as auditService from "../src/audit/service";
import { readPragmas } from "../src/db/client";
import { bootstrap, type RunningServer, startServer } from "../src/startup";
import { removeTempDirs, sweepStaleTempDirs } from "./helpers/temp-dirs";

// Wraps the real AuditService; failAudit makes every record() throw (the configLoaded fail-closed case).
const failAudit = vi.hoisted(() => ({ on: false }));
vi.mock("../src/audit/service", async (importOriginal) => {
  const real = await importOriginal<typeof auditService>();
  return {
    createAuditService: (...args: Parameters<typeof real.createAuditService>) => {
      const svc = real.createAuditService(...args);
      return {
        record: (...a: Parameters<typeof svc.record>) => {
          if (failAudit.on) throw new Error("audit store unavailable");
          return svc.record(...a);
        },
      };
    },
  };
});
afterEach(() => {
  failAudit.on = false;
});

const PREFIXES = ["qm-data-", "qm-sec-", "qm-cfg-"];
// A prior Windows run may have left dirs behind (see removeTempDirs); sweep ones over 10 minutes old.
sweepStaleTempDirs(tmpdir(), 10 * 60 * 1000, PREFIXES);
const created: string[] = [];
afterAll(() => removeTempDirs(created.splice(0), "test/startup"));
const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};

/** Stops a started server and asserts stop() closed its database client, on every platform. */
async function stop(s: RunningServer): Promise<void> {
  await s.stop();
  expect(s.deps.db.$client.closed).toBe(true);
}

/** readDeployEnv refuses PORT 0 (spec 8.1), so the test asks the OS for a free port first. */
async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address() as { port: number };
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

const k = (fill: number) => Buffer.alloc(32, fill).toString("base64");
async function envWith(files: Record<string, string> = {}, dataDir = tempDir("qm-data-")) {
  const secrets = tempDir("qm-sec-");
  const all = {
    DB_ENCRYPTION_KEY: k(1),
    CREDENTIAL_KEY: k(2),
    DATA_KEY: k(3),
    BETTER_AUTH_SECRET: k(4),
    ...files,
  };
  for (const [n, v] of Object.entries(all)) if (v !== "") writeFileSync(join(secrets, n), v);
  return {
    NODE_ENV: "test",
    PORT: String(await freePort()),
    PUBLIC_ORIGIN: "http://localhost:3000",
    DATA_DIR: dataDir,
    SECRETS_DIR: secrets,
    ALLOW_MOCK_SOURCES: "true",
  };
}

/** A copy of the bundled default site config with auth.mfaRequired replaced. */
function siteConfigWithMfa(mfaRequired: unknown): string {
  const configDir = resolve(import.meta.dirname, "../../config");
  const root = tempDir("qm-cfg-");
  cpSync(join(configDir, "locales"), join(root, "locales"), { recursive: true });
  cpSync(join(configDir, "mock"), join(root, "mock"), { recursive: true });
  mkdirSync(join(root, "sites"));
  const site = JSON.parse(readFileSync(join(configDir, "sites/default.json"), "utf8"));
  site.auth.mfaRequired = mfaRequired;
  const file = join(root, "sites/mfa.json");
  writeFileSync(file, JSON.stringify(site));
  return file;
}

describe("SEC-006 startup fails closed", () => {
  it("serves health after every check passes, with pragmas intact", async () => {
    const s = await startServer(await envWith(), { logSink: () => {} });
    const r = await fetch(`http://127.0.0.1:${s.port}/api/v1/health`);
    expect(r.status).toBe(200);
    expect(await readPragmas(s.deps.db)).toMatchObject({
      journal_mode: "wal",
      synchronous: 2,
      secure_delete: 1,
      busy_timeout: 5000,
      foreign_keys: 1,
    });
    await stop(s);
    await expect(fetch(`http://127.0.0.1:${s.port}/api/v1/health`)).rejects.toThrow();
  });
  it("refuses without DATA_KEY", async () => {
    await expect(
      startServer(await envWith({ DATA_KEY: "" }), { logSink: () => {} }),
    ).rejects.toThrow(/DATA_KEY/);
  });
  it("refuses a mismatched CREDENTIAL_KEY on the second boot", async () => {
    const data = tempDir("qm-data-");
    const first = await startServer(await envWith({}, data), { logSink: () => {} });
    await stop(first);
    await expect(
      startServer(await envWith({ CREDENTIAL_KEY: k(9) }, data), { logSink: () => {} }),
    ).rejects.toThrow(/CREDENTIAL_KEY/);
  });
  it("refuses a wrong DB_ENCRYPTION_KEY", async () => {
    const data = tempDir("qm-data-");
    await stop(await startServer(await envWith({}, data), { logSink: () => {} }));
    await expect(
      startServer(await envWith({ DB_ENCRYPTION_KEY: k(8) }, data), { logSink: () => {} }),
    ).rejects.toThrow(/database open failed/);
  });
  it("refuses when an audit trigger is missing", async () => {
    const data = tempDir("qm-data-");
    const s = await startServer(await envWith({}, data), { logSink: () => {} });
    await s.deps.db.$client.execute("DROP TRIGGER audit_event_no_update");
    await stop(s);
    await expect(startServer(await envWith({}, data), { logSink: () => {} })).rejects.toThrow(
      /audit_event triggers missing/,
    );
  });
  it("refuses when the port is already taken", async () => {
    const env = await envWith();
    const taken = createServer();
    await new Promise<void>((r) => taken.listen(Number(env.PORT), "0.0.0.0", r));
    try {
      await expect(startServer(env, { logSink: () => {} })).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await new Promise<void>((r) => taken.close(() => r()));
    }
  });
  it("refuses an invalid site config", async () => {
    const bad = join(tempDir("qm-cfg-"), "bad.json");
    writeFileSync(bad, "{}");
    await expect(
      startServer({ ...(await envWith()), SITE_CONFIG: bad }, { logSink: () => {} }),
    ).rejects.toThrow(/config/);
  });
});

// Checker ruling 09-28-26 (T19 spec:CV1): SEC-005 MFA is not enforced until M3 P1 (#216), so a
// site config that requires it must not start. #216 removes this guard when MFA lands.
describe("SEC-005 startup refuses a site config that requires MFA before MFA exists", () => {
  for (const [label, mfaRequired] of [
    ["true", true],
    ["by roles", { roles: ["admin"] }],
  ] as const) {
    it(`refuses auth.mfaRequired ${label}, logging no secrets`, async () => {
      const lines: string[] = [];
      const env = { ...(await envWith()), SITE_CONFIG: siteConfigWithMfa(mfaRequired) };
      await expect(startServer(env, { logSink: (l) => lines.push(l) })).rejects.toThrow(
        /mfaRequired/,
      );
      const logged = lines.join("\n");
      expect(logged).toMatch(/mfaRequired/);
      for (const n of [1, 2, 3, 4]) expect(logged).not.toContain(k(n));
    });
  }
  it("starts when auth.mfaRequired is false", async () => {
    const env = { ...(await envWith()), SITE_CONFIG: siteConfigWithMfa(false) };
    const s = await startServer(env, { logSink: () => {} });
    const r = await fetch(`http://127.0.0.1:${s.port}/api/v1/health`);
    expect(r.status).toBe(200);
    await stop(s);
  });
});

const exampleOk = resolve(import.meta.dirname, "../../config/sites/example-ok.json");

describe("SEC-010 SEC-012 BR-001 configLoaded at startup (spec 5.8 step 7)", () => {
  async function configLoadedRows(deps: Awaited<ReturnType<typeof bootstrap>>) {
    const r = await deps.db.$client.execute(
      "SELECT actor_user_id, actor_email, actor_role, identity_source, correlation_id, part_id, credential_user_id, details FROM audit_event WHERE type = 'configLoaded' ORDER BY id",
    );
    return r.rows.map((row) => ({ ...row, details: JSON.parse(String(row.details)) }));
  }

  it("configLoaded: writes one system row per start with the resolved config identity", async () => {
    const env = { ...(await envWith()), SITE_CONFIG: exampleOk };
    const first = await bootstrap(env, { logSink: () => {} });
    const rows = await configLoadedRows(first);
    first.db.$client.close();
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({
      actor_user_id: "system",
      actor_email: null,
      actor_role: "system",
      identity_source: "system",
      correlation_id: null,
      part_id: null,
      credential_user_id: null,
      details: {
        siteId: "example-ok",
        configHash: first.config.configHash,
        configSchemaVersion: 1,
        coreVersion: CORE_VERSION,
        extendsChain: ["default"],
      },
    });
    const second = await bootstrap(env, { logSink: () => {} });
    const again = await configLoadedRows(second);
    second.db.$client.close();
    expect(again.length).toBe(2);
    expect(again[1]?.details).toEqual(rows[0]?.details);
  });

  it("configLoaded: an audit failure refuses startup and nothing listens", async () => {
    const env = await envWith();
    failAudit.on = true;
    await expect(startServer(env, { logSink: () => {} })).rejects.toThrow(
      /audit store unavailable/,
    );
    await expect(fetch(`http://127.0.0.1:${env.PORT}/api/v1/health`)).rejects.toThrow();
  });
});
