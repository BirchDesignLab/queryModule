import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CONFIG_SCHEMA_VERSION, CORE_VERSION } from "@querymodule/core/contracts";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type * as auditService from "../src/audit/service";
import { ConfigLoadError } from "../src/config/load";
import type * as dbClient from "../src/db/client";
import { readPragmas } from "../src/db/client";
import { KeyCanaryError } from "../src/keys/canary";
import { SecretConfigError } from "../src/secrets";
import {
  bootstrap,
  loadDeps,
  type RunningServer,
  StartupRefusedError,
  startServer,
  startupErrorFields,
} from "../src/startup";
import { removeTempDirs, sweepStaleTempDirs } from "./helpers/temp-dirs";

// Wraps the real AuditService; with failAudit on, record() rejects AFTER the real insert of a
// configLoaded event only, so the fail-closed case proves the transaction rolls that row back
// (A2 review M1) and cannot pass because some earlier audit write failed instead (#303).
const failAudit = vi.hoisted(() => ({ on: false }));
vi.mock("../src/audit/service", async (importOriginal) => {
  const real = await importOriginal<typeof auditService>();
  return {
    createAuditService: (...args: Parameters<typeof real.createAuditService>) => {
      const svc = real.createAuditService(...args);
      return {
        record: async (...a: Parameters<typeof svc.record>) => {
          const written = await svc.record(...a);
          if (failAudit.on && a[1].type === "configLoaded")
            throw new Error("audit store unavailable");
          return written;
        },
      };
    },
  };
});
afterEach(() => {
  failAudit.on = false;
});

// Records every database a start opens, so a failed start can be shown to close its handle
// (wave review C-m2): openDatabase takes no exclusive lock, so a clean restart cannot prove it.
const opened = vi.hoisted(() => [] as { $client: { closed: boolean } }[]);
vi.mock("../src/db/client", async (importOriginal) => {
  const real = await importOriginal<typeof dbClient>();
  return {
    ...real,
    openDatabase: async (...a: Parameters<typeof real.openDatabase>) => {
      const db = await real.openDatabase(...a);
      opened.push(db);
      return db;
    },
  };
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

/** Resolves with the error code of a TCP connect to 127.0.0.1:port, or "connected". */
function connectError(port: number): Promise<string> {
  return new Promise((r) => {
    const sock = connect(port, "127.0.0.1");
    sock.once("connect", () => {
      sock.destroy();
      r("connected");
    });
    sock.once("error", (e: NodeJS.ErrnoException) => r(e.code ?? "unknown"));
  });
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

interface SiteJson {
  auth: { mfaRequired: unknown };
  defaults: Record<string, unknown>;
}

/** A copy of the bundled default site config, changed by edit. */
function siteConfigWith(edit: (site: SiteJson) => void): string {
  const configDir = resolve(import.meta.dirname, "../../config");
  const root = tempDir("qm-cfg-");
  cpSync(join(configDir, "locales"), join(root, "locales"), { recursive: true });
  cpSync(join(configDir, "mock"), join(root, "mock"), { recursive: true });
  mkdirSync(join(root, "sites"));
  const site = JSON.parse(readFileSync(join(configDir, "sites/default.json"), "utf8")) as SiteJson;
  edit(site);
  const file = join(root, "sites/edited.json");
  writeFileSync(file, JSON.stringify(site));
  return file;
}

/** A copy of the bundled default site config with auth.mfaRequired replaced. */
const siteConfigWithMfa = (mfaRequired: unknown): string =>
  siteConfigWith((site) => {
    site.auth.mfaRequired = mfaRequired;
  });

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
  it("refuses a mismatched DATA_KEY on the second boot: names DATA_KEY only, no key material, port never bound (spec 10.3, #311)", async () => {
    const data = tempDir("qm-data-");
    await stop(await startServer(await envWith({}, data), { logSink: () => {} }));
    const env = await envWith({ DATA_KEY: k(9) }, data);
    const err = await startServer(env, { logSink: () => {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyCanaryError);
    expect((err as KeyCanaryError).keyName).toBe("data");
    const message = (err as Error).message;
    expect(message).toBe("key canary for DATA_KEY does not decrypt");
    for (const fill of [1, 2, 3, 9]) {
      const key = Buffer.alloc(32, fill);
      for (const enc of ["base64", "hex"] as const)
        expect(message).not.toContain(key.toString(enc));
    }
    expect(await connectError(Number(env.PORT))).toBe("ECONNREFUSED");
    expect(opened.at(-1)?.$client.closed).toBe(true);
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

describe("spec 5.8 step 5, 5.9 config warnings are logged by key and path only", () => {
  it("logs one config warning line per warning, with no config value", async () => {
    const env = {
      ...(await envWith()),
      SITE_CONFIG: siteConfigWith((site) => {
        site.defaults.zzUnused = "SECRETVALUE-zz";
      }),
    };
    const lines: string[] = [];
    const deps = await loadDeps(env, { logSink: (l) => lines.push(l) });
    deps.db.$client.close();
    const warned = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.msg === "config warning")
      .map(({ time: _time, ...rest }) => rest);
    expect(warned).toEqual([
      {
        level: "warn",
        msg: "config warning",
        key: "config.unusedSiteDefault",
        path: "/defaults/zzUnused",
      },
      // The bundled site's required-without-position warnings: VEH plateType, then PRO and PROP
      // make and caliber and PROP description (#346).
      ...[
        "/queryTypes/0/rules/1/field",
        "/queryTypes/2/rules/1/field",
        "/queryTypes/2/rules/1/field",
        "/queryTypes/2/rules/3/field",
        "/queryTypes/2/rules/3/field",
        "/queryTypes/2/rules/6/field",
      ].map((path) => ({
        level: "warn",
        msg: "config warning",
        key: "config.conditionallyRequiredWithoutPosition",
        path,
      })),
    ]);
    expect(lines.join("\n")).not.toContain("SECRETVALUE");
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
        configHash: first.config.current().configHash,
        configSchemaVersion: CONFIG_SCHEMA_VERSION,
        coreVersion: CORE_VERSION,
        // ADR-0011: the live config comes from the store, whose document is the resolved site
        // (extends already merged), so a boot from the store extends nothing (Task 25, ruled #494).
        extendsChain: [],
      },
    });
    const second = await bootstrap(env, { logSink: () => {} });
    const again = await configLoadedRows(second);
    second.db.$client.close();
    expect(again.length).toBe(2);
    expect(again[1]?.details).toEqual(rows[0]?.details);
  });

  it("configLoaded: loadDeps (the ops scripts' entry) loads the config but records no start (wave review C-m1)", async () => {
    const env = { ...(await envWith()), SITE_CONFIG: exampleOk };
    const deps = await loadDeps(env, { logSink: () => {} });
    const rows = await configLoadedRows(deps);
    deps.db.$client.close();
    expect(deps.config.current().siteConfig.site.id).toBe("example-ok");
    expect(rows).toEqual([]);
  });

  it("configLoaded: an audit failure refuses startup, commits no row and nothing listens", async () => {
    const data = tempDir("qm-data-");
    const env = await envWith({}, data);
    const lines: string[] = [];
    failAudit.on = true;
    opened.length = 0;
    // LS-2: the rethrown error is fixed text; the audit error's own message never leaves.
    const refusal = await startServer(env, { logSink: (l) => lines.push(l) }).catch((e) => e);
    expect(refusal).toBeInstanceOf(StartupRefusedError);
    expect(refusal.message).toBe("startup refused: configLoaded audit write failed");
    expect(refusal.cause).toBeUndefined();
    // Like the MFA guard: one fixed "startup refused" line naming the step, with no values.
    const refused = lines.map((l) => JSON.parse(l)).filter((l) => l.msg === "startup refused");
    expect(refused).toEqual([
      expect.objectContaining({ level: "error", reason: "configLoaded audit write failed" }),
    ]);
    const logged = lines.join("\n");
    expect(logged).not.toContain("audit store unavailable");
    for (const n of [1, 2, 3, 4]) expect(logged).not.toContain(k(n));
    // Nothing listens: a TCP connect to the configured port is refused.
    expect(await connectError(Number(env.PORT))).toBe("ECONNREFUSED");
    // The failed start opened exactly one database and closed it.
    expect(opened.map((db) => db.$client.closed)).toEqual([true]);
    // It rolled its row back: a clean restart on the same data dir finds exactly its own row.
    failAudit.on = false;
    const next = await bootstrap(env, { logSink: () => {} });
    const rows = await configLoadedRows(next);
    next.db.$client.close();
    expect(rows.length).toBe(1);
  });
});

describe("SEC-006 spec 5.9 the startup stderr line (M1 phase review LS-2)", () => {
  const FAKE_SECRET = "ZZFAKESECRETVALUE0123456789";

  it("keeps the message of a fixed-text startup error", () => {
    for (const e of [
      new StartupRefusedError("configLoaded audit write failed"),
      new ConfigLoadError("site.json", "/auth", "config.invalid"),
      new KeyCanaryError("data"),
      new SecretConfigError("DATA_KEY", "file is empty"),
    ])
      expect(startupErrorFields(e)).toEqual({ name: e.name, message: e.message });
  });

  it("writes only the name, and a driver code, of any other error", () => {
    const query = new Error(`Failed query: insert into "user"\nparams: ${FAKE_SECRET}`, {
      cause: Object.assign(new Error(`constraint ${FAKE_SECRET}`), { code: "SQLITE_CONSTRAINT" }),
    });
    expect(startupErrorFields(query)).toEqual({ name: "Error", code: "SQLITE_CONSTRAINT" });
    const named = new TypeError(`bad ${FAKE_SECRET}`);
    expect(startupErrorFields(named)).toEqual({ name: "TypeError" });
    expect(startupErrorFields(FAKE_SECRET)).toEqual({ name: "unknown" });
    // A forged name never carries a value either.
    const forged = new Error("x");
    forged.name = `Error ${FAKE_SECRET}`;
    expect(JSON.stringify(startupErrorFields(forged))).not.toContain(FAKE_SECRET);
  });
});
