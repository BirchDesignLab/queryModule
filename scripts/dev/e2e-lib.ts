// Testable pieces of the e2e launcher (round 1 review findings C1, C2 on #124):
// seeding must fail loudly instead of being swallowed, and readiness must not
// be satisfied by a server the launcher did not spawn.

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export type Fetcher = (url: string) => Promise<{ ok: boolean }>;
export type Sleeper = (ms: number) => Promise<void>;

const defaultSleep: Sleeper = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves true only when the URL answers with an ok response; never throws. */
export function probeHealth(url: string, fetchFn: Fetcher = fetch): Promise<boolean> {
  return fetchFn(url).then(
    (r) => r.ok,
    () => false,
  );
}

export interface ReadyServer {
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  once(event: "error", listener: (err: Error) => void): unknown;
}

export interface WaitForReadyOptions {
  url: string;
  server: ReadyServer;
  attempts?: number;
  delayMs?: number;
  fetchFn?: Fetcher;
  sleepFn?: Sleeper;
}

export interface WaitForReadyResult {
  up: boolean;
  reason?: string;
}

/**
 * Polls `url` for readiness while also watching the spawned `server` itself.
 * Resolves as soon as either the health check succeeds or the server exits /
 * errors, so a dead child is reported immediately instead of after a 60s
 * timeout, and a health check that only succeeds because *another* process
 * already holds the port never reads as "ready" once the child has died.
 */
export function waitForReady(opts: WaitForReadyOptions): Promise<WaitForReadyResult> {
  const {
    url,
    server,
    attempts = 60,
    delayMs = 1000,
    fetchFn = fetch,
    sleepFn = defaultSleep,
  } = opts;
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (result: WaitForReadyResult) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };
    server.once("exit", (code, signal) => {
      finish({
        up: false,
        reason: `server exited before it became ready (code ${code}, signal ${signal})`,
      });
    });
    server.once("error", (err) => {
      finish({ up: false, reason: `server failed to start: ${err.message}` });
    });
    void (async () => {
      for (let i = 0; i < attempts && !settled; i++) {
        const ok = await probeHealth(url, fetchFn);
        if (ok) {
          finish({ up: true });
          return;
        }
        await sleepFn(delayMs);
      }
      finish({ up: false, reason: "timed out waiting for the health check to succeed" });
    })();
  });
}

export interface RunSeedOptions {
  seedJsPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  existsSyncFn?: (path: string) => boolean;
  spawnSyncFn?: (
    cmd: string,
    args: string[],
    opts: Record<string, unknown>,
  ) => SpawnSyncReturns<Buffer>;
}

export interface RunSeedResult {
  ok: boolean;
  reason?: string;
}

/**
 * Runs the built seed script and reports failure instead of swallowing it.
 * Refuses (rather than silently skipping) when `dist/ops/seed.js` is missing,
 * since that means Task 24 has not landed and the database is unseeded.
 * stderr/stdout are inherited so a real seed failure's cause is visible.
 */
export function runSeed(opts: RunSeedOptions): RunSeedResult {
  const { seedJsPath, cwd, env, existsSyncFn = existsSync, spawnSyncFn = spawnSync } = opts;
  if (!existsSyncFn(seedJsPath)) {
    return { ok: false, reason: `seed script missing: ${seedJsPath} (Task 24 has not landed yet)` };
  }
  const result = spawnSyncFn("node", [seedJsPath], {
    cwd,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    return { ok: false, reason: `seed exited with code ${result.status}` };
  }
  return { ok: true };
}

export interface E2eTarget {
  port: string;
  origin: string;
  healthUrl: string;
}

/**
 * Where `pnpm e2e` serves: port 3000, or `E2E_PORT` so a second lane can run beside it. A bad
 * value fails fast rather than falling back to a port another lane may be using.
 */
export function e2eTarget(env: Readonly<Record<string, string | undefined>>): E2eTarget {
  const raw = env.E2E_PORT;
  const port = raw === undefined || raw === "" ? "3000" : raw;
  const n = Number(port);
  if (!/^\d+$/.test(port) || n < 1 || n > 65535)
    throw new Error(`E2E_PORT must be an integer from 1 to 65535, got "${port}"`);
  const origin = `http://localhost:${port}`;
  return { port, origin, healthUrl: `${origin}/api/v1/health` };
}

export const SMOKE_EMAIL = "smoke@example.test";

/**
 * The seeded smoke login for local runs (#410), derived as ci.yml does: base64url(HMAC-SHA256(
 * trimmed seed secret, email)). A complete pair the caller set wins; exactly one of the two is an
 * error, not a silent replacement. Errors name the variable, never the secret, the derived
 * password or a value the caller set.
 */
export function smokeCredentials(
  env: Readonly<Record<string, string | undefined>>,
  secretFile: string,
  readFileFn: (path: string, encoding: "utf8") => string = readFileSync,
): { E2E_USER_EMAIL: string; E2E_USER_PASSWORD: string } {
  const email = env.E2E_USER_EMAIL;
  const password = env.E2E_USER_PASSWORD;
  const hasEmail = email !== undefined && email !== "";
  const hasPassword = password !== undefined && password !== "";
  if (hasEmail && hasPassword) return { E2E_USER_EMAIL: email, E2E_USER_PASSWORD: password };
  // Half a pair would be replaced silently by the derived login: a different user than the caller
  // asked for. Say which one is missing (the name only, never a value).
  if (hasEmail !== hasPassword) {
    throw new Error(
      `${hasEmail ? "E2E_USER_PASSWORD" : "E2E_USER_EMAIL"} is not set: set both E2E_USER_EMAIL and E2E_USER_PASSWORD, or neither to use the seeded smoke login`,
    );
  }
  let secret: string;
  try {
    secret = readFileFn(secretFile, "utf8").trim();
  } catch {
    throw new Error("SEED_PASSWORD_SECRET unreadable: run pnpm dev once or set E2E_USER_PASSWORD");
  }
  return {
    E2E_USER_EMAIL: SMOKE_EMAIL,
    E2E_USER_PASSWORD: createHmac("sha256", secret).update(SMOKE_EMAIL).digest("base64url"),
  };
}
