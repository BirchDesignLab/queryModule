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

/** A fatal error ended the SIGTERM drain (spec 8.1): the fatal close owns the teardown. */
export class DrainAbortedError extends Error {
  constructor() {
    super("drain: fatal close");
    this.name = "DrainAbortedError";
  }
}

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
 * The drain's bound on in-flight HTTP requests (critic C1): a client that trickles its body must
 * not hold stop() until Node's requestTimeout. A submit that commits T1 during this wait gets a
 * deadline up to its timeoutMs later, so the worst case is HTTP_DRAIN_MS + max timeoutMs +
 * DRAIN_SLACK_MS: 2 + 18 + 5 = 25 s at the 18 s timeoutMs docs/deploy.md allows, 5 s inside the
 * 30 s stop_grace_period (spec 8.3) for the sockets, the DB close and the exit.
 */
export const HTTP_DRAIN_MS = 2_000;

/**
 * Counts the server's in-flight HTTP requests (WebSocket upgrades are not requests), so the
 * drain waits for them without waiting on open feed sockets.
 */
function trackRequests(server: Server): { idle(): Promise<void>; open(): number } {
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
  return {
    idle: () =>
      open === 0
        ? Promise.resolve()
        : new Promise<void>((r) => {
            waiters.add(r);
          }),
    open: () => open,
  };
}

/**
 * The SIGTERM drain (spec 5.2; NFR-003), in this order: mark the app draining (new submits get
 * 503 unavailable), refuse new WebSocket upgrades, stop listening and wait for in-flight HTTP
 * requests up to HTTP_DRAIN_MS (a submit already past the 503 check finishes T1 and enqueues),
 * then cut every connection still open, stop dispatch intake (anything later stays pending for
 * the next start's sweep; the route logs a refused enqueue during the drain without d.fatal),
 * wait for in-flight dispatch up to max(0, maxDeadline - now) + DRAIN_SLACK_MS, then close the
 * sockets and the DB and log stopped. The fatal path (AppDeps.fatal) never runs this drain: once
 * lifecycle.failed is set, at the start or after any wait, the drain logs "drain ended by fatal
 * error", never "stopped", and rejects with DrainAbortedError, leaving the sockets and the DB to
 * the fatal close (main.ts exits 1). Call right after the server listens.
 */
export function createDrainStop(deps: AppDeps, server: Server, ws: WsHandle): () => Promise<void> {
  const requests = trackRequests(server);
  const endIfFailed = () => {
    if (!deps.lifecycle.failed) return;
    deps.logger.error("drain ended by fatal error");
    throw new DrainAbortedError();
  };
  return async () => {
    endIfFailed();
    deps.lifecycle.draining = true;
    ws.stopAccepting();
    server.close();
    server.closeIdleConnections();
    let timer: unknown;
    const timedOut = await Promise.race([
      requests.idle().then(() => false),
      new Promise<boolean>((r) => {
        timer = deps.timers.setTimeout(() => r(true), HTTP_DRAIN_MS);
      }),
    ]);
    deps.timers.clearTimeout(timer);
    endIfFailed();
    if (timedOut) {
      deps.logger.warn("drain http wait timed out", { open: requests.open() });
      // upgraded WS sockets are no longer the server's connections, so the feed stays open
      server.closeAllConnections();
    }
    // keep-alive connections that served the last requests are idle now
    server.closeIdleConnections();
    deps.dispatcher.stopIntake();
    const now = deps.clock.now();
    const latest = deps.dispatcher.maxDeadline() ?? now;
    await deps.dispatcher.drain(Math.max(0, latest - now) + DRAIN_SLACK_MS);
    endIfFailed();
    await ws.close();
    endIfFailed();
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
   * The fatal path's close (spec 8.1), never the drain: sets lifecycle.failed, aborts every
   * adapter call, then closes the sockets, the server (cutting open requests) and the DB without
   * waiting on dispatch.
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
      deps.lifecycle.failed = true;
      deps.dispatcher.abortAll();
      ws.stopAccepting();
      await ws.close();
      await new Promise<void>((r) => {
        server.close(() => r());
        // a request still open (a trickled body, a held T1) must not hold the fatal close
        server.closeAllConnections();
      });
      closeDb(deps);
    },
  };
}
