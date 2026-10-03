import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadLiveConfig } from "./admin/config/store";
import { createAuditService } from "./audit/service";
import { type Auth, createAuth } from "./auth/auth";
import { type AppIdentityService, createIdentityService } from "./auth/identity";
import { createRateLimiter, type RateLimiter } from "./auth/rate-limit";
import { type Clock, type MonotonicClock, systemClock, systemMonotonic } from "./clock";
import type { LoadedConfig } from "./config/load";
import { type Db, openDatabase } from "./db/client";
import {
  checkAuditTriggers,
  checkConfigVersionTriggers,
  checkQueryTriggers,
  runMigrations,
} from "./db/migrate";
import type { DeployEnv } from "./env";
import { type AppEventBus, createEventBus } from "./events/bus";
import { checkKeyCanaries } from "./keys/canary";
import { createLogger, type Logger } from "./log/logger";
import type { AuditService } from "./seams";
import type { Secrets } from "./secrets";

export interface AppDeps {
  env: DeployEnv;
  db: Db;
  auth: Auth;
  identity: AppIdentityService;
  audit: AuditService;
  limiter: RateLimiter;
  logger: Logger;
  config: LoadedConfig;
  clock: Clock;
  /** Durations for audit details (spec 4.7). */
  monotonic: MonotonicClock;
  /** DATA_KEY: wraps each request's DEKs (spec 5.5 request_key, SEC-006). */
  dataKey: Buffer;
  eventBus: AppEventBus;
}

export async function buildDeps(o: {
  env: DeployEnv;
  secrets: Secrets;
  clock?: Clock;
  logSink?: (line: string) => void;
}): Promise<AppDeps> {
  const clock = o.clock ?? systemClock;
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
    const limits = config.siteConfig.auth.session;
    const auth = createAuth({
      db,
      env: o.env,
      secret: s.betterAuthSecret,
      session: limits,
      log: logger,
    });
    return {
      env: o.env,
      db,
      auth,
      clock,
      monotonic: systemMonotonic,
      dataKey: s.dataKey,
      logger,
      config,
      identity: createIdentityService({ db, auth, limits, clock, log: logger }),
      audit: createAuditService(clock),
      limiter: createRateLimiter(db, clock),
      eventBus: createEventBus({ log: logger }),
    };
  } catch (e) {
    db.$client.close();
    throw e;
  }
}
