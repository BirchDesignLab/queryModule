import { once } from "node:events";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, relative } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { openDatabase } from "../../src/db/client";
import { checkAuditTriggers } from "../../src/db/migrate";
import { withTransaction } from "../../src/db/tx";
import { type AppDeps, buildDeps } from "../../src/deps";
import type { DeployEnv } from "../../src/env";
import { type DbResetOptions, probeApp, runDbReset } from "../../src/ops/db-reset";
import { grantRole } from "../../src/ops/grant-role";
import { derivePassword } from "../../src/seed/password";
import { seedUsers } from "../../src/seed/seed";
import { DEMO_USERS } from "../../src/seed/users";
import { TEST_DB_KEY, tempDbFile } from "../helpers/db";
import { createTestClock, TEST_SECRETS, type TestClock, testEnv } from "../helpers/fixture";
import { manualTime } from "../helpers/manual-time";

const SECRET = TEST_SECRETS.seedPasswordSecret as string;
const HOUR = 60 * 60 * 1000;

/** A port nothing listens on: bound once, then closed. */
async function refusedPort(): Promise<number> {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** A stand-in for the running app: answers its health route. */
async function healthServer(): Promise<string> {
  const s: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"status":"ok"}');
  });
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  onTestFinished(() => new Promise<void>((r) => s.close(() => r())));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1/health`;
}

interface Site {
  env: DeployEnv;
  clock: TestClock;
  logLines: string[];
  backupRoot: string;
  open: () => Promise<AppDeps>;
  out: string[];
  err: string[];
  opts(over?: Partial<DbResetOptions>): Promise<DbResetOptions>;
  snapshot(): Promise<{ users: string[]; audit: number; maxId: number; backups: string[] }>;
}

/** A seeded demo database on a temp data dir, the way the live demo looks before a reset. */
async function seededSite(): Promise<Site> {
  const env = testEnv();
  const clock = createTestClock();
  const logLines: string[] = [];
  const opened: AppDeps[] = [];
  onTestFinished(() => {
    for (const d of opened) if (!d.db.$client.closed) d.db.$client.close();
  });
  const open = async () => {
    const d = await buildDeps({
      env,
      secrets: TEST_SECRETS,
      clock,
      logSink: (l) => logLines.push(l),
      timers: manualTime().timers,
      onFatal: () => {},
    });
    opened.push(d);
    return d;
  };
  const first = await open();
  await seedUsers(first, SECRET);
  // a row only the old database has
  await grantRole(first, { email: "dispatcher@example.test", role: "admin", change: "granted" });
  first.db.$client.close();
  // backups go to a temp dir of their own, outside the data dir (removed by helpers/db afterAll)
  const backupRoot = dirname(tempDbFile());
  const out: string[] = [];
  const err: string[] = [];
  const site: Site = {
    env,
    clock,
    logLines,
    backupRoot,
    open,
    out,
    err,
    async opts(over = {}) {
      return {
        env,
        open,
        seedSecret: async () => SECRET,
        backupRoot,
        healthUrl: `http://127.0.0.1:${await refusedPort()}/api/v1/health`,
        clock,
        out: (s) => out.push(s),
        err: (s) => err.push(s),
        ...over,
      };
    },
    async snapshot() {
      const db = await openDatabase({ file: env.dbFile, encryptionKey: TEST_DB_KEY });
      try {
        const users = (await db.$client.execute("SELECT email FROM user ORDER BY email")).rows.map(
          (r) => String(r.email),
        );
        const a = (
          await db.$client.execute(
            "SELECT count(*) AS n, coalesce(max(id), 0) AS m FROM audit_event",
          )
        ).rows[0];
        return {
          users,
          audit: Number(a?.n),
          maxId: Number(a?.m),
          backups: readdirSync(backupRoot),
        };
      } finally {
        db.$client.close();
      }
    },
  };
  return site;
}

describe("#821 db:reset usage", () => {
  it.each([
    [[]],
    [["--confirm"]],
    [["--confirm", ""]],
    [["--confirm", "default", "extra"]],
    [["default"]],
    [["--confirm=default"]],
    [["--force", "--confirm", "default"]],
    [["--confirm", "default", "--confirm", "default"]],
  ])("argv %j is a usage error (exit 2) before anything is opened", async (argv) => {
    const open = vi.fn();
    const out: string[] = [];
    const err: string[] = [];
    const code = await runDbReset(argv, {
      env: testEnv(),
      open,
      seedSecret: async () => SECRET,
      backupRoot: dirname(tempDbFile()),
      healthUrl: "http://127.0.0.1:1/api/v1/health",
      clock: createTestClock(),
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    });
    expect(code).toBe(2);
    expect(open).not.toHaveBeenCalled();
    expect(err.join("")).toContain("usage: db-reset --confirm <site>");
    expect(out).toEqual([]);
  });
});

describe("#821 db:reset guards (ADR-0015)", () => {
  it("refuses with the env gate off, before opening the database", async () => {
    const s = await seededSite();
    const before = await s.snapshot();
    const open = vi.fn(s.open);
    const env = { ...s.env, allowMockSources: false };
    const code = await runDbReset(["--confirm", "default"], await s.opts({ env, open }));
    expect(code).toBe(1);
    expect(open).not.toHaveBeenCalled();
    expect(s.err.join("")).toContain("ALLOW_MOCK_SOURCES");
    expect(await s.snapshot()).toEqual(before);
  });

  it("refuses when there is no database, creating none", async () => {
    const env = testEnv();
    const open = vi.fn();
    const err: string[] = [];
    const code = await runDbReset(["--confirm", "default"], {
      env,
      open,
      seedSecret: async () => SECRET,
      backupRoot: dirname(tempDbFile()),
      healthUrl: "http://127.0.0.1:1/api/v1/health",
      clock: createTestClock(),
      out: () => {},
      err: (s) => err.push(s),
    });
    expect(code).toBe(1);
    expect(open).not.toHaveBeenCalled();
    expect(err.join("")).toContain("no database to reset");
    expect(existsSync(env.dbFile)).toBe(false);
  });

  it("refuses a site with a source that is not mock", async () => {
    const s = await seededSite();
    const before = await s.snapshot();
    const open = async () => {
      const d = await s.open();
      const c = d.config.current();
      const real = { ...(c.siteConfig.sources[0] as (typeof c.siteConfig.sources)[number]) };
      real.kind = "stateHttp";
      d.config.swap({
        ...c,
        siteConfig: { ...c.siteConfig, sources: [...c.siteConfig.sources, real] },
      });
      return d;
    };
    const code = await runDbReset(["--confirm", "default"], await s.opts({ open }));
    expect(code).toBe(1);
    expect(s.err.join("")).toContain("not mock");
    expect(await s.snapshot()).toEqual(before);
  });

  it("refuses a --confirm that does not name the loaded site", async () => {
    const s = await seededSite();
    const before = await s.snapshot();
    const code = await runDbReset(["--confirm", "other"], await s.opts());
    expect(code).toBe(1);
    expect(s.err.join("")).toContain("--confirm does not name the loaded site");
    expect(await s.snapshot()).toEqual(before);
  });

  it("refuses while the app answers its health check, before opening the database", async () => {
    const s = await seededSite();
    const before = await s.snapshot();
    // CW3 review Q3: opening runs the start sequence, which can write; a live app's database is
    // never opened.
    const open = vi.fn(s.open);
    const code = await runDbReset(
      ["--confirm", "default"],
      await s.opts({ open, healthUrl: await healthServer() }),
    );
    expect(code).toBe(1);
    expect(s.err.join("")).toContain("docker compose stop app");
    expect(open).not.toHaveBeenCalled();
    expect(await s.snapshot()).toEqual(before);
  });

  it("refuses a site whose loaded config has no mock file", async () => {
    const s = await seededSite();
    const before = await s.snapshot();
    const open = async () => {
      const d = await s.open();
      d.config.swap({ ...d.config.current(), mock: null });
      return d;
    };
    const code = await runDbReset(["--confirm", "default"], await s.opts({ open }));
    expect(code).toBe(1);
    expect(s.err.join("")).toContain("not mock");
    expect(await s.snapshot()).toEqual(before);
  });

  it("refuses when a writer takes the lock after the database opened (guard 4)", {
    timeout: 30_000,
  }, async () => {
    const s = await seededSite();
    const before = await s.snapshot();
    const other = await openDatabase({ file: s.env.dbFile, encryptionKey: TEST_DB_KEY });
    onTestFinished(() => {
      if (!other.$client.closed) other.$client.close();
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held: Promise<void> = Promise.resolve();
    const open = async () => {
      const d = await s.open();
      let locked: () => void = () => {};
      const isLocked = new Promise<void>((r) => {
        locked = r;
      });
      held = withTransaction(other, async () => {
        locked();
        await gate;
      });
      await isLocked;
      return d;
    };
    let code: number;
    try {
      code = await runDbReset(["--confirm", "default"], await s.opts({ open }));
    } finally {
      release();
      await held;
      other.$client.close();
    }
    expect(code).toBe(1);
    expect(s.err.join("")).toContain("the database is busy (");
    expect(await s.snapshot()).toEqual(before);
  });

  it("refuses while another connection holds a write lock on the database", {
    timeout: 30_000,
  }, async () => {
    const s = await seededSite();
    const before = await s.snapshot();
    const other = await openDatabase({ file: s.env.dbFile, encryptionKey: TEST_DB_KEY });
    onTestFinished(() => {
      if (!other.$client.closed) other.$client.close();
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((r) => {
      locked = r;
    });
    const held = withTransaction(other, async () => {
      locked();
      await gate;
    });
    await isLocked;
    let code: number;
    try {
      code = await runDbReset(["--confirm", "default"], await s.opts());
    } finally {
      release();
      await held;
      other.$client.close();
    }
    expect(code).toBe(1);
    expect(s.err.join("")).toContain("database is busy");
    expect(await s.snapshot()).toEqual(before);
  });

  it("a backup into the data dir fails and deletes nothing", async () => {
    const s = await seededSite();
    const before = await s.snapshot();
    const code = await runDbReset(
      ["--confirm", "default"],
      await s.opts({ backupRoot: join(s.env.dataDir, "backups") }),
    );
    expect(code).toBe(1);
    expect(s.err.join("")).toContain("backup failed; nothing was deleted");
    expect(await s.snapshot()).toEqual(before);
  });
});

describe("#821 health probe", () => {
  it("connection refused means not running", async () => {
    expect(await probeApp(`http://127.0.0.1:${await refusedPort()}/api/v1/health`)).toBe("stopped");
  });
  it("a DNS failure means not running", async () => {
    expect(await probeApp("http://app.invalid:3000/api/v1/health")).toBe("stopped");
  });
  it("an answer means running", async () => {
    expect(await probeApp(await healthServer())).toBe("running");
  });
  it("any other failure is unknown (fail closed)", async () => {
    // a server that accepts and never answers: the probe times out
    const s = createServer(() => {});
    s.listen(0, "127.0.0.1");
    await once(s, "listening");
    onTestFinished(() => {
      s.closeAllConnections();
      return new Promise<void>((r) => s.close(() => r()));
    });
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1/health`;
    expect(await probeApp(url, 200)).toBe("unknown");
  });
});

// Windows cannot delete a libsql file while any handle on it is open, and @libsql/client leaves
// each transaction's connection to the garbage collector, so the wipe step fails there (EPERM).
// The deploy host is Linux, where the unlink succeeds; CI runs this test there.
describe.skipIf(process.platform === "win32")("#821 db:reset full run", () => {
  it("backs up, wipes, migrates and reseeds; passwords only in stdout's table", {
    timeout: 30_000,
  }, async () => {
    const s = await seededSite();
    const before = await s.snapshot();
    s.clock.advance(HOUR);
    const resetAt = s.clock.now();
    const code = await runDbReset(["--confirm", "default"], await s.opts());
    const stdout = s.out.join("");
    const stderr = s.err.join("");
    expect(stderr).toBe("");
    expect(code).toBe(0);

    // the backup exists outside the data dir and stdout names it
    const backups = readdirSync(s.backupRoot);
    expect(backups).toHaveLength(1);
    const dir = join(s.backupRoot, backups[0] as string);
    const file = join(dir, "querymodule.db");
    expect(existsSync(file)).toBe(true);
    expect(relative(s.env.dataDir, file).startsWith("..")).toBe(true);
    expect(stdout).toContain(file);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      auditCount: number;
      auditMaxId: number;
    };
    expect(manifest.auditCount).toBe(before.audit);
    expect(manifest.auditMaxId).toBe(before.maxId);
    expect(stdout).toContain(`audit rows ${before.audit}, max id ${before.maxId}`);

    // the new database: audit triggers, the demo users, and only this run's audit rows
    const d = await s.open();
    await checkAuditTriggers(d.db);
    const emails = (await d.db.$client.execute("SELECT email FROM user")).rows.map((r) =>
      String(r.email),
    );
    expect(emails.sort()).toEqual(DEMO_USERS.map((u) => u.email).sort());
    const rows = (await d.db.$client.execute("SELECT type, at, details FROM audit_event")).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(Number(r.at)).toBeGreaterThanOrEqual(resetAt);
    const dispatcher = (
      await d.db.$client.execute("SELECT role FROM user WHERE email = 'dispatcher@example.test'")
    ).rows[0];
    expect(dispatcher?.role).toBe("user");
    d.db.$client.close();

    // the seed's table on stdout, every password derived; nowhere else
    expect(stdout).toContain("email\trole\tpassword\n");
    for (const u of DEMO_USERS) {
      const pw = derivePassword(SECRET, u.email);
      expect(stdout).toContain(`${u.email}\t${u.role}\t${pw}\n`);
      expect(stderr).not.toContain(pw);
      expect(s.logLines.join("\n")).not.toContain(pw);
    }
    expect(stdout).toContain("added 0 missing demo accounts");
  });
});
