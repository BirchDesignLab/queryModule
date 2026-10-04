import { join } from "node:path";
import { type BundledPaths, bundledPaths } from "./paths";

export type IdentityMode = "standalone" | "embedded";
export interface DeployEnv {
  nodeEnv: "production" | "development" | "test";
  port: number;
  publicOrigin: string;
  dataDir: string;
  dbFile: string;
  secretsDir: string;
  siteConfigFile: string;
  adapterDir: string | null;
  allowMockSources: boolean;
  identityModes: IdentityMode[];
  minClientVersion: string | null;
  corsOrigins: string[];
  frameAncestors: string[];
  webDist: string | null;
  migrationsDir: string;
}

export const DEV_ORIGINS: readonly string[] = ["http://localhost:5173", "http://localhost:3000"];

/**
 * A malformed deploy env (spec 8.1). The message is fixed text naming the variable, never its
 * value, so startup's stderr line may print it (spec 5.9).
 */
export class DeployEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeployEnvError";
  }
}

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Fail closed (spec 8.1): a malformed PORT is a startup error, never NaN. */
function readPort(v: string | undefined): number {
  const raw = v ?? "3000";
  const port = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
  if (!(port >= 1 && port <= 65535))
    throw new DeployEnvError("PORT must be an integer from 1 to 65535");
  return port;
}

export function readDeployEnv(env: NodeJS.ProcessEnv, defaults?: BundledPaths): DeployEnv {
  // bundled defaults are resolved only when an env var is missing, so fully specified envs never probe the disk
  const def = (): BundledPaths => defaults ?? bundledPaths();
  const nodeEnv =
    env.NODE_ENV === "development" || env.NODE_ENV === "test" ? env.NODE_ENV : "production";
  const publicOrigin = env.PUBLIC_ORIGIN?.trim();
  if (!publicOrigin || !/^https?:\/\/[^/]+$/.test(publicOrigin)) {
    throw new DeployEnvError("PUBLIC_ORIGIN must be an origin like https://host");
  }
  const modes = list(env.IDENTITY_MODES ?? "standalone");
  for (const m of modes) {
    if (m !== "standalone" && m !== "embedded") {
      throw new DeployEnvError("IDENTITY_MODES may list only standalone and embedded");
    }
  }
  const dataDir = env.DATA_DIR ?? "/data";
  const base = list(env.CORS_ORIGINS);
  const corsOrigins = [
    ...new Set([
      ...(base.length ? base : [publicOrigin]),
      ...(nodeEnv === "development" ? DEV_ORIGINS : []),
    ]),
  ];
  return {
    nodeEnv,
    port: readPort(env.PORT),
    publicOrigin,
    dataDir,
    dbFile: join(dataDir, "querymodule.db"),
    secretsDir: env.SECRETS_DIR ?? "/run/secrets",
    siteConfigFile: env.SITE_CONFIG ?? join(def().configDir, "sites/default.json"),
    adapterDir: env.ADAPTER_DIR ?? null,
    allowMockSources: env.ALLOW_MOCK_SOURCES === "true",
    identityModes: modes as IdentityMode[],
    minClientVersion: env.MIN_CLIENT_VERSION?.trim() || null,
    corsOrigins,
    frameAncestors: list(env.FRAME_ANCESTORS),
    webDist: env.WEB_DIST === "" ? null : (env.WEB_DIST ?? def().webDist),
    migrationsDir: env.MIGRATIONS_DIR ?? def().migrationsDir,
  };
}
