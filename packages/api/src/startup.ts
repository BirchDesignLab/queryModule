import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { CONFIG_SCHEMA_VERSION, CORE_VERSION, SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { createApp } from "./app";
import type { Clock } from "./clock";
import { withTransaction } from "./db/tx";
import { type AppDeps, buildDeps } from "./deps";
import { readDeployEnv } from "./env";
import { loadSecrets } from "./secrets";
import { attachWebSocket } from "./ws/server";

export class StartupRefusedError extends Error {
  constructor(reason: string) {
    super(`startup refused: ${reason}`);
    this.name = "StartupRefusedError";
  }
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
 * The server's startup sequence: loadDeps, then one configLoaded audit row per start (spec 5.8
 * step 7, SEC-010); a failed write closes the database and refuses startup.
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
          configHash: c.configHash,
          configSchemaVersion: CONFIG_SCHEMA_VERSION,
          coreVersion: CORE_VERSION,
          extendsChain: c.extendsChain,
        },
      }),
    );
  } catch (e) {
    // Fixed reason, like the MFA guard: the error itself is not logged, so no value can leak.
    deps.logger.error("startup refused", {
      reason: "configLoaded audit write failed",
      site: deps.config.current().siteConfig.site.id,
    });
    deps.db.$client.close();
    throw e;
  }
  return deps;
}

export interface RunningServer {
  port: number;
  deps: AppDeps;
  stop(): Promise<void>;
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
    async stop() {
      ws.stopAccepting();
      await ws.close();
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeIdleConnections();
      });
      deps.db.$client.close();
      deps.logger.info("stopped");
    },
  };
}
