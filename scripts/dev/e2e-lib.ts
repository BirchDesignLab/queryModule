// Testable pieces of the e2e launcher (round 1 review findings C1, C2 on #124):
// seeding must fail loudly instead of being swallowed, and readiness must not
// be satisfied by a server the launcher did not spawn.

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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
