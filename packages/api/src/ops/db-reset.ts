import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Clock } from "../clock";
import { withTransaction } from "../db/tx";
import type { AppDeps } from "../deps";
import { type DeployEnv, DeployEnvError } from "../env";
import { errorFields } from "../log/error-fields";
import { SeedPartialFailureError, seedUsers } from "../seed/seed";
import { AddDemoUsersPartialFailureError, addMissingDemoUsers } from "./add-demo-users";
import { takeBackup } from "./backup";

/*
 * #821, ADR-0016: the one path that removes audit rows, and only by replacing the whole demo
 * database file after a backup. The triggers are never dropped: the old file goes whole and the
 * fresh one is migrated, which recreates them. Guards, each refusing with fixed text and nothing
 * left behind: ALLOW_MOCK_SOURCES, the app does not answer its health route (both before the
 * database is opened), then a mock-only loaded site, --confirm names it, and the database is not
 * busy.
 * Passwords go only to `out` (the command's stdout), as seed.ts prints them (spec 5.9).
 */

export const DB_RESET_USAGE = "usage: db-reset --confirm <site>";

export interface DbResetOptions {
  env: DeployEnv;
  /** Opens, migrates and checks the database at env.dbFile (loadDeps in the CLI). */
  open: () => Promise<AppDeps>;
  /** SEED_PASSWORD_SECRET, read after the guards and before anything is deleted. */
  seedSecret: () => Promise<string>;
  /** Where the backup directory goes; must resolve outside the data dir (takeBackup checks). */
  backupRoot: string;
  /** The compose app service's health route, http://app:<PORT>/api/v1/health in the CLI. */
  healthUrl: string;
  clock: Clock;
  out: (s: string) => void;
  err: (s: string) => void;
  /** Test seams for the steps after the delete; the CLI uses the real ones. */
  removeDatabase?: (dbFile: string) => void;
  seed?: typeof seedUsers;
  addDemoUsers?: typeof addMissingDemoUsers;
}

/** The health route of the app service as `docker compose run` resolves it (ruling 1). */
export function dbResetHealthUrl(host: string, port: number): string {
  return `http://${host}:${port}/api/v1/health`;
}

/** Exactly `--confirm <site>` with a non-empty site; anything else is a usage error. */
export function parseDbResetArgs(argv: readonly string[]): { site: string } | null {
  if (argv.length !== 2 || argv[0] !== "--confirm") return null;
  const site = argv[1];
  if (site === undefined || site.trim() === "" || site.startsWith("--")) return null;
  return { site };
}

/** The HTTP failures that mean nothing listens; EAI_AGAIN is temporary, so it is unknown (#829). */
const NOT_RUNNING_CODES = new Set(["ECONNREFUSED", "ENOTFOUND"]);
/** Docker's DNS answers "not found" for a stopped compose service after about 4 s (#829). */
export const DB_RESET_DNS_TIMEOUT_MS = 10_000;

/** Resolves the probe host; any answer will do. Seam for tests. */
export type ProbeLookup = (host: string) => Promise<unknown>;

/** The lookup's answer: resolved, not found, or anything else (a timeout, EAI_AGAIN). */
async function resolveHost(
  lookup: ProbeLookup,
  host: string,
  timeoutMs: number,
): Promise<"found" | "notFound" | "unknown"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"unknown">((resolve) => {
    timer = setTimeout(() => resolve("unknown"), timeoutMs);
  });
  try {
    return await Promise.race([
      lookup(host).then(
        () => "found" as const,
        (e: unknown) =>
          (e as { code?: unknown } | null)?.code === "ENOTFOUND"
            ? ("notFound" as const)
            : ("unknown" as const),
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The system codes on a fetch failure: its cause, or each error of an AggregateError cause. */
function causeCodes(e: unknown): string[] {
  const cause = (e as { cause?: unknown }).cause;
  if (cause === null || typeof cause !== "object") return [];
  const list = cause instanceof AggregateError ? [cause, ...cause.errors] : [cause];
  return list
    .map((c) => (c as { code?: unknown }).code)
    .filter((c): c is string => typeof c === "string");
}

/**
 * Ruling 1, as amended on #829 (M2 Manager 10, 10-20-26): the host is resolved first, with its own
 * budget (dnsTimeoutMs), so a slow "not found" from Docker's DNS does not use up the HTTP budget.
 * A name that does not resolve (ENOTFOUND) means the app does not run. Then any HTTP answer means
 * it runs, and a refused connection means it does not. Anything else (a lookup timeout, EAI_AGAIN,
 * an HTTP timeout, a reset) is unknown, which the caller refuses (fail closed).
 */
export async function probeApp(
  url: string,
  timeoutMs = 3000,
  o: { lookup?: ProbeLookup; dnsTimeoutMs?: number } = {},
): Promise<"running" | "stopped" | "unknown"> {
  const host = new URL(url).hostname.replace(/^\[(.*)\]$/, "$1");
  const dns = await resolveHost(
    o.lookup ?? ((h) => dnsLookup(h)),
    host,
    o.dnsTimeoutMs ?? DB_RESET_DNS_TIMEOUT_MS,
  );
  if (dns === "notFound") return "stopped";
  if (dns === "unknown") return "unknown";
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    await r.body?.cancel();
    return "running";
  } catch (e) {
    const codes = causeCodes(e);
    return codes.length > 0 && codes.every((c) => NOT_RUNNING_CODES.has(c)) ? "stopped" : "unknown";
  }
}

/** A refusal: fixed text, never a value from the database, a secret or an error message. */
class Refused extends Error {}

function errorText(e: unknown): string {
  const f = errorFields(e);
  return f.code ? `${f.name} ${f.code}` : f.name;
}

/** The mock gate's second half (ruling 2): the loaded site's sources are all mock. */
function mockOnly(d: AppDeps): boolean {
  const c = d.config.current();
  const sources = c.siteConfig.sources;
  return c.mock !== null && sources.length > 0 && sources.every((s) => s.kind === "mock");
}

/** Guards 1 (site half), 2 and 4 on the open database; throws Refused. */
async function guard(d: AppDeps, site: string): Promise<void> {
  if (!mockOnly(d))
    throw new Refused(
      "the loaded site has a source that is not mock; db-reset runs on a mock-only demo site only (ADR-0016)",
    );
  if (d.config.current().siteConfig.site.id !== site)
    throw new Refused("--confirm does not name the loaded site");
  // BEGIN IMMEDIATE through the client's own path; in WAL mode IMMEDIATE and EXCLUSIVE take the
  // same write lock. A writer holding it outlasts busy_timeout and this throws SQLITE_BUSY.
  try {
    await withTransaction(d.db, async () => {});
  } catch (e) {
    throw new Refused(
      `the database is busy (${errorText(e)}); stop the app first: docker compose stop app`,
    );
  }
}

function printAccounts(
  out: (s: string) => void,
  rows: readonly { email: string; role: string; password: string }[],
): void {
  for (const r of rows) out(`${r.email}\t${r.role}\t${r.password}\n`);
}

/** Removes the database file and its WAL and shared-memory files. */
function removeDatabase(dbFile: string): void {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rmSync(f, { force: true });
}

/**
 * The wrapper's stderr line for an error that escaped the env read or runDbReset (#829 G-m2):
 * the class and any driver or system code, plus a DeployEnvError's fixed text; never any other
 * message (spec 5.9).
 */
export function dbResetFailureLine(e: unknown): string {
  const f = errorFields(e, [DeployEnvError]);
  return `db-reset: ${f.name}${f.code ? ` ${f.code}` : ""}${f.message ? `: ${f.message}` : ""}\n`;
}

/** Runs db:reset; returns the exit code (0 done, 1 refused or failed, 2 usage). */
export async function runDbReset(argv: readonly string[], o: DbResetOptions): Promise<number> {
  const args = parseDbResetArgs(argv);
  if (!args) {
    o.err(`${DB_RESET_USAGE}\n`);
    return 2;
  }
  const refuse = (reason: string) => {
    o.err(`db-reset refused: ${reason}\n`);
    return 1;
  };
  if (!o.env.allowMockSources)
    return refuse(
      "ALLOW_MOCK_SOURCES is not true; db-reset runs on a mock-only demo site only (ADR-0016)",
    );
  if (!existsSync(o.env.dbFile)) return refuse("there is no database to reset");
  // Guard 3 before the database is opened (CW3 review Q3): opening runs the start sequence
  // (migrations, config store seed, draft cleanup), which can write, so a live app's database is
  // never opened.
  const probe = await probeApp(o.healthUrl);
  if (probe === "running")
    return refuse("the app answers its health check; stop it first: docker compose stop app");
  if (probe === "unknown")
    return refuse(
      "could not check whether the app is running; stop it with docker compose stop app and retry",
    );

  let secret: string;
  let backupFile: string;
  let old: AppDeps;
  try {
    old = await o.open();
  } catch (e) {
    // opening runs the start sequence, whose config load takes the write lock (guard 4)
    return refuse(
      errorFields(e).code === "SQLITE_BUSY"
        ? "the database is busy; stop the app first: docker compose stop app"
        : `the database did not open (${errorText(e)})`,
    );
  }
  try {
    await guard(old, args.site);
    try {
      secret = await o.seedSecret();
    } catch {
      return refuse("SEED_PASSWORD_SECRET could not be read");
    }
    const stamp = new Date(o.clock.now()).toISOString().replace(/[-:]/g, "").replace(/\..*$/, "Z");
    const dir = join(o.backupRoot, `db-reset-${stamp}`);
    // a rerun within the same second never writes over the earlier backup (#829, ruling 10-20-26)
    if (existsSync(dir))
      throw new Refused(`the backup directory ${dir} exists; wait a second and run it again`);
    let m: Awaited<ReturnType<typeof takeBackup>>;
    try {
      m = await takeBackup(old.db, o.env.dbFile, dir, o.clock);
    } catch (e) {
      o.err(`db-reset: backup failed; nothing was deleted (${errorText(e)})\n`);
      return 1;
    }
    backupFile = join(dir, basename(o.env.dbFile));
    o.out(
      `backup written: ${backupFile} (manifest ${join(dir, "manifest.json")}: audit rows ${m.auditCount}, max id ${m.auditMaxId})\n`,
    );
  } catch (e) {
    if (e instanceof Refused) return refuse(e.message);
    throw e;
  } finally {
    old.db.$client.close();
  }

  const failed = (what: string, e: unknown) => {
    o.err(`db-reset: ${what} (${errorText(e)}); restore from ${backupFile} (docs/deploy.md)\n`);
    return 1;
  };
  try {
    (o.removeDatabase ?? removeDatabase)(o.env.dbFile);
  } catch (e) {
    return failed("could not remove the old database", e);
  }
  let d: AppDeps;
  try {
    d = await o.open();
  } catch (e) {
    return failed("the new database did not open and migrate", e);
  }
  try {
    o.out("email\trole\tpassword\n");
    try {
      printAccounts(o.out, await (o.seed ?? seedUsers)(d, secret));
    } catch (e) {
      if (e instanceof SeedPartialFailureError) {
        printAccounts(o.out, e.created);
        o.err(`db-reset: ${e.message}; restore from ${backupFile} (docs/deploy.md)\n`);
        return 1;
      }
      return failed("the seed failed", e);
    }
    try {
      const added = await (o.addDemoUsers ?? addMissingDemoUsers)(d, secret);
      printAccounts(o.out, added.created);
      o.out(`added ${added.created.length} missing demo accounts\n`);
    } catch (e) {
      if (e instanceof AddDemoUsersPartialFailureError) {
        printAccounts(o.out, e.created);
        o.err(`db-reset: ${e.message}; restore from ${backupFile} (docs/deploy.md)\n`);
        return 1;
      }
      return failed("add-demo-users failed", e);
    }
    o.out(`db-reset done; the old database is in ${backupFile}\n`);
    return 0;
  } finally {
    d.db.$client.close();
  }
}
