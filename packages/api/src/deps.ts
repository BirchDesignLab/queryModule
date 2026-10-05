import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createAdapterRegistry } from "./adapters/registry";
import type { AdapterRegistry } from "./adapters/types";
import { loadLiveConfig } from "./admin/config/store";
import { createAuditService } from "./audit/service";
import { type Auth, createAuth } from "./auth/auth";
import { type AppIdentityService, createIdentityService } from "./auth/identity";
import { createRateLimiter, type RateLimiter } from "./auth/rate-limit";
import { type Clock, type MonotonicClock, systemClock, systemMonotonic } from "./clock";
import type { VersionedConfig } from "./config/load";
import { type Db, openDatabase } from "./db/client";
import {
  checkAuditTriggers,
  checkConfigVersionTriggers,
  checkQueryTriggers,
  runMigrations,
} from "./db/migrate";
import { createDispatcher, type Dispatcher } from "./dispatch/dispatcher";
import { recordOutcome } from "./dispatch/outcome";
import { systemTimers, type Timers } from "./dispatch/timers";
import type { DeployEnv } from "./env";
import { type AppEventBus, createEventBus } from "./events/bus";
import { checkKeyCanaries } from "./keys/canary";
import { createLogger, type RootLogger } from "./log/logger";
import type { AuditService } from "./seams";
import type { Secrets } from "./secrets";

/**
 * The live config snapshot (ADR-0011 item 3). Readers call current() at use and keep that one
 * snapshot for the rest of their work; swap replaces it atomically for the next reader.
 */
export interface ConfigHolder {
  current(): VersionedConfig;
  swap(next: VersionedConfig): void;
}

export function createConfigHolder(initial: VersionedConfig): ConfigHolder {
  let live = initial;
  return {
    current: () => live,
    swap(next) {
      live = next;
    },
  };
}

export interface AppDeps {
  env: DeployEnv;
  db: Db;
  auth: Auth;
  identity: AppIdentityService;
  audit: AuditService;
  limiter: RateLimiter;
  /** Root logger: activate extends its redaction keys with each published version's fields. */
  logger: RootLogger;
  config: ConfigHolder;
  clock: Clock;
  /** Durations for audit details (spec 4.7). */
  monotonic: MonotonicClock;
  /** DATA_KEY: wraps each request's DEKs (spec 5.5 request_key, SEC-006). */
  dataKey: Buffer;
  eventBus: AppEventBus;
  /** Adapters per config snapshot (spec 5.4); mock only when allowMockSources. */
  adapters: AdapterRegistry;
  /** Runs acknowledged (part, source) jobs under deadlines and caps (spec 5.2 step 5). */
  dispatcher: Dispatcher;
  timers: Timers;
  /**
   * Fail closed on an error that leaves the process unsafe to continue (spec 8.1): aborts every
   * adapter call first (SEC-010), then exits through main.ts fail(), never the SIGTERM drain.
   */
  fatal(e: unknown): void;
}

export async function buildDeps(o: {
  env: DeployEnv;
  secrets: Secrets;
  clock?: Clock;
  logSink?: (line: string) => void;
  /** Tests drive dispatch time; the server uses the system ones. */
  timers?: Timers;
  monotonic?: MonotonicClock;
  random?: () => number;
  /**
   * Called by fatal after abortAll. Default: rethrow outside any promise chain, so main.ts's
   * uncaughtException handler fail() exits 1. Tests record instead of crashing the runner.
   */
  onFatal?: (e: unknown) => void;
}): Promise<AppDeps> {
  const clock = o.clock ?? systemClock;
  const monotonic = o.monotonic ?? systemMonotonic;
  mkdirSync(dirname(o.env.dbFile), { recursive: true });
  const db = await openDatabase({ file: o.env.dbFile, encryptionKey: o.secrets.dbEncryptionKey });
  try {
    await runMigrations(db, o.env.migrationsDir);
    await checkAuditTriggers(db);
    await checkQueryTriggers(db);
    await checkConfigVersionTriggers(db);
    await checkKeyCanaries(db, o.secrets, clock);
    // ADR-0011: the store is the live source; an empty store seeds version 1 from the file.
    const config = await loadLiveConfig(db, {
      siteConfigFile: o.env.siteConfigFile,
      allowMockSources: o.env.allowMockSources,
      now: clock.now(),
    });
    const s = o.secrets;
    const logger = createLogger({
      ...(o.logSink ? { sink: o.logSink } : {}),
      redactKeys: config.fieldKeys,
      secretValues: [
        s.dbEncryptionKey,
        s.credentialKey.toString("base64"),
        s.dataKey.toString("base64"),
        s.betterAuthSecret,
        ...(s.seedPasswordSecret ? [s.seedPasswordSecret] : []),
      ],
    });
    const site = config.siteConfig.site.id;
    if (config.seeded) logger.info("config store seeded", { site, version: config.version });
    if (config.fileIgnored)
      logger.warn("site config file ignored", {
        file: o.env.siteConfigFile,
        site,
        version: config.version,
      });
    for (const w of config.warnings) logger.warn("config warning", { key: w.key, path: w.path });
    const holder = createConfigHolder(config);
    const timers = o.timers ?? systemTimers;
    const adapters = createAdapterRegistry({
      allowMockSources: o.env.allowMockSources,
      timers,
      random: o.random ?? Math.random,
      logger,
    });
    // Each outcome is written by transaction T2 (spec 5.2 step 6); deps is set before any job runs.
    const dispatcher = createDispatcher(
      { adapters, clock, monotonic, timers, logger },
      (job, out, ms) => recordOutcome(deps, job, out, ms),
    );
    // Better Auth's own expiry is fixed at boot; the app limits below are read at use.
    const auth = createAuth({
      db,
      env: o.env,
      secret: s.betterAuthSecret,
      session: config.siteConfig.auth.session,
      log: logger,
    });
    const onFatal =
      o.onFatal ??
      ((e: unknown) =>
        queueMicrotask(() => {
          throw e;
        }));
    const deps: AppDeps = {
      env: o.env,
      db,
      auth,
      clock,
      monotonic,
      dataKey: s.dataKey,
      logger,
      config: holder,
      identity: createIdentityService({
        db,
        auth,
        limits: () => holder.current().siteConfig.auth.session,
        clock,
        log: logger,
      }),
      audit: createAuditService(clock),
      limiter: createRateLimiter(db, clock),
      eventBus: createEventBus({ log: logger }),
      adapters,
      dispatcher,
      timers,
      // No adapter call continues while audit is broken (SEC-010); then fail closed.
      fatal(e) {
        dispatcher.abortAll();
        onFatal(e);
      },
    };
    return deps;
  } catch (e) {
    db.$client.close();
    throw e;
  }
}
