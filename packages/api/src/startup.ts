import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { CONFIG_SCHEMA_VERSION, CORE_VERSION, SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { createApp } from "./app";
import type { Clock } from "./clock";
import { ConfigLoadError } from "./config/load";
import { DatabaseLockTimeoutError, DatabaseOpenError } from "./db/client";
import { TriggerMissingError } from "./db/migrate";
import { withTransaction } from "./db/tx";
import { type AppDeps, buildDeps } from "./deps";
import { sweepPending } from "./dispatch/sweep";
import { DeployEnvError, readDeployEnv } from "./env";
import { KeyCanaryError } from "./keys/canary";
import { type ErrorFields, errorFields } from "./log/error-fields";
import { loadSecrets, SecretConfigError } from "./secrets";
import { attachWebSocket, type WsHandle } from "./ws/server";

export class StartupRefusedError extends Error {
  constructor(reason: string) {
    super(`startup refused: ${reason}`);
    this.name = "StartupRefusedError";
  }
}

/**
 * The startup errors whose message is app-built fixed text, never a value: key names, file
 * paths, trigger names. Their message reaches stderr (main.ts), so a class added to this list
 * must never embed a runtime value (a query param, a config value, a key, an adapter's text).
 */
const FIXED_TEXT_STARTUP_ERRORS = [
  StartupRefusedError,
  DeployEnvError,
  ConfigLoadError,
  SecretConfigError,
  KeyCanaryError,
  TriggerMissingError,
  DatabaseOpenError,
  DatabaseLockTimeoutError,
];

/**
 * LS-2 (spec 5.9, 8.1): the error fields main.ts writes to stderr when startup is refused. A
 * failed seed insert or migration throws a query error whose message quotes its params, so the
 * message is written only for the fixed-text startup errors; any other error gives its name and
 * its driver or Node system code only (EADDRINUSE, not the message, which quotes the address).
 */
export function startupErrorFields(err: unknown): ErrorFields {
  return errorFields(err, FIXED_TEXT_STARTUP_ERRORS);
}

/**
 * Fail closed (spec 8.1): nothing is served until the secrets load, the deploy env parses,
 * migrations are applied, both audit triggers exist, both key canaries decrypt and the site
 * config parses. Every failure throws; none returns a partial AppDeps. Records no start: the ops
 * scripts (seed, grant-role) use this, so configLoaded rows count server starts only (C-m1).
 */
export async function loadDeps(
  processEnv: NodeJS.ProcessEnv,
  o: { clock?: Clock; logSink?: (line: string) => void } = {},
): Promise<AppDeps> {
  const env = readDeployEnv(processEnv);
  const secrets = await loadSecrets(processEnv, env.secretsDir);
  const deps = await buildDeps({ env, secrets, ...o });
  // Checker ruling 09-28-26 (T19 spec:CV1): SEC-005 MFA is not enforced anywhere until M3 P1
  // (#216), so a site that requires it must not start. #216 removes this guard.
  const config = deps.config.current();
  if (config.siteConfig.auth.mfaRequired !== false) {
    const reason = "site config auth.mfaRequired is set, but MFA is not enforced until #216";
    deps.logger.error("startup refused", { reason, site: config.siteConfig.site.id });
    deps.db.$client.close();
    throw new StartupRefusedError(reason);
  }
  return deps;
}

/**
 * Refuses startup after a failed step (spec 8.1): one "startup refused" line with the fixed
 * reason and the error's name and driver code only, never its message, which can quote query
 * values (spec 5.9; #511 C-M-1); then closes the database. The thrown error is fixed text with
 * no cause, so nothing of the original error reaches main.ts's stderr line (LS-2).
 */
function refuse(deps: AppDeps, reason: string, e: unknown): StartupRefusedError {
  deps.logger.error("startup refused", {
    reason,
    site: deps.config.current().siteConfig.site.id,
    error: errorFields(e),
  });
  deps.db.$client.close();
  return new StartupRefusedError(reason);
}

/**
 * The server's startup sequence: loadDeps, then one configLoaded audit row per start (spec 5.8
 * step 7, SEC-010), then the startup sweep that settles every pending result as interrupted
 * (spec 5.2), all before the server listens. A failed step closes the database and refuses
 * startup.
 */
export async function bootstrap(
  processEnv: NodeJS.ProcessEnv,
  o: { clock?: Clock; logSink?: (line: string) => void } = {},
): Promise<AppDeps> {
  const deps = await loadDeps(processEnv, o);
  try {
    const c = deps.config.current();
    await withTransaction(deps.db, (tx) =>
      deps.audit.record(tx, {
        type: "configLoaded",
        actor: SYSTEM_ACTOR,
        identitySource: "system",
        details: {
          siteId: c.siteConfig.site.id,
          versionId: c.versionId,
          configHash: c.configHash,
          configSchemaVersion: CONFIG_SCHEMA_VERSION,
          coreVersion: CORE_VERSION,
          extendsChain: c.extendsChain,
        },
      }),
    );
  } catch (e) {
    throw refuse(deps, "configLoaded audit write failed", e);
  }
  try {
    const swept = await sweepPending(deps);
    deps.logger.info("startup sweep", swept);
  } catch (e) {
    throw refuse(deps, "startup sweep failed", e);
  }
  return deps;
}

/** The drain's slack past the latest in-flight deadline (spec 5.2), for T2 to commit. */
export const DRAIN_SLACK_MS = 5_000;

/**
 * Counts the server's in-flight HTTP requests (WebSocket upgrades are not requests), so the
 * drain waits for them without waiting on open feed sockets.
 */
function trackRequests(server: Server): () => Promise<void> {
  let open = 0;
  const waiters = new Set<() => void>();
  server.on("request", (_req, res) => {
    open += 1;
    res.once("close", () => {
      open -= 1;
      if (open > 0) return;
      for (const wake of waiters) wake();
      waiters.clear();
    });
  });
  return () =>
    open === 0
      ? Promise.resolve()
      : new Promise<void>((r) => {
          waiters.add(r);
        });
}

/**
 * The SIGTERM drain (spec 5.2; NFR-003), in this order: mark the app draining (new submits get
 * 503 unavailable), refuse new WebSocket upgrades, stop listening and wait for in-flight HTTP
 * requests (a submit already past the 503 check finishes T1 and enqueues), stop dispatch intake
 * (anything later stays pending for the next start's sweep), wait for in-flight dispatch up to
 * max(0, maxDeadline - now) + DRAIN_SLACK_MS, then close the sockets and the DB and log stopped.
 * The fatal path (AppDeps.fatal) never runs this drain. Call right after the server listens.
 */
export function createDrainStop(deps: AppDeps, server: Server, ws: WsHandle): () => Promise<void> {
  const httpIdle = trackRequests(server);
  return async () => {
    deps.lifecycle.draining = true;
    ws.stopAccepting();
    server.close();
    server.closeIdleConnections();
    await httpIdle();
    // keep-alive connections that served the last requests are idle now
    server.closeIdleConnections();
    deps.dispatcher.stopIntake();
    const now = deps.clock.now();
    const latest = deps.dispatcher.maxDeadline() ?? now;
    await deps.dispatcher.drain(Math.max(0, latest - now) + DRAIN_SLACK_MS);
    await ws.close();
    closeDb(deps);
    deps.logger.info("stopped");
  };
}

/** Idempotent: the fatal close and a SIGTERM drain may both reach it. */
function closeDb(deps: AppDeps): void {
  if (!deps.db.$client.closed) deps.db.$client.close();
}

export interface RunningServer {
  port: number;
  deps: AppDeps;
  /** The SIGTERM drain (createDrainStop). */
  stop(): Promise<void>;
  /**
   * The fatal path's close (spec 8.1), never the drain: aborts every adapter call, then closes
   * the sockets, the server and the DB without waiting on dispatch.
   */
  close(): Promise<void>;
}

export async function startServer(
  processEnv: NodeJS.ProcessEnv,
  o: { clock?: Clock; logSink?: (line: string) => void } = {},
): Promise<RunningServer> {
  const deps = await bootstrap(processEnv, o);
  const server = serve({
    fetch: createApp(deps).fetch,
    port: deps.env.port,
    hostname: "0.0.0.0",
  }) as Server;
  try {
    // once() rejects on 'error', so a taken port refuses startup instead of crashing later
    if (!server.listening) await once(server, "listening");
  } catch (e) {
    deps.db.$client.close();
    throw e;
  }
  const ws = attachWebSocket(server, deps);
  const stop = createDrainStop(deps, server, ws);
  const port = (server.address() as AddressInfo).port;
  const live = deps.config.current();
  deps.logger.info("listening", {
    port,
    site: live.siteConfig.site.id,
    configHash: live.configHash,
  });
  return {
    port,
    deps,
    stop,
    async close() {
      deps.dispatcher.abortAll();
      ws.stopAccepting();
      await ws.close();
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeIdleConnections();
      });
      closeDb(deps);
    },
  };
}
