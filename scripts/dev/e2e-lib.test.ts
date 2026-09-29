import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { e2eTarget, probeHealth, runSeed, waitForReady } from "./e2e-lib.ts";

describe("runSeed (review C1: seed failure must not be swallowed)", () => {
  it("fails without running seed when the built seed script is missing", () => {
    const spawnSyncFn = vi.fn();
    const result = runSeed({
      seedJsPath: "/repo/packages/api/dist/ops/seed.js",
      cwd: "/repo",
      env: {},
      existsSyncFn: () => false,
      spawnSyncFn,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/seed script missing/);
    expect(spawnSyncFn).not.toHaveBeenCalled();
  });

  it("fails and reports the exit code when the seed process exits non-zero", () => {
    const spawnSyncFn = vi.fn().mockReturnValue({ status: 1 });
    const result = runSeed({
      seedJsPath: "/repo/packages/api/dist/ops/seed.js",
      cwd: "/repo",
      env: {},
      existsSyncFn: () => true,
      spawnSyncFn,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exited with code 1/);
  });

  it("keeps stderr visible instead of discarding it (stdio inherits stderr)", () => {
    const spawnSyncFn = vi.fn().mockReturnValue({ status: 0 });
    runSeed({
      seedJsPath: "/repo/packages/api/dist/ops/seed.js",
      cwd: "/repo",
      env: {},
      existsSyncFn: () => true,
      spawnSyncFn,
    });
    expect(spawnSyncFn).toHaveBeenCalledWith(
      "node",
      ["/repo/packages/api/dist/ops/seed.js"],
      expect.objectContaining({ stdio: ["ignore", "inherit", "inherit"] }),
    );
  });

  it("succeeds when the seed process exits 0", () => {
    const spawnSyncFn = vi.fn().mockReturnValue({ status: 0 });
    const result = runSeed({
      seedJsPath: "/repo/packages/api/dist/ops/seed.js",
      cwd: "/repo",
      env: {},
      existsSyncFn: () => true,
      spawnSyncFn,
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("probeHealth", () => {
  it("resolves true only on an ok response", async () => {
    await expect(probeHealth("http://x", async () => ({ ok: true }))).resolves.toBe(true);
    await expect(probeHealth("http://x", async () => ({ ok: false }))).resolves.toBe(false);
  });

  it("resolves false instead of throwing when the fetch rejects", async () => {
    await expect(
      probeHealth("http://x", async () => {
        throw new Error("ECONNREFUSED");
      }),
    ).resolves.toBe(false);
  });
});

describe("waitForReady (review C2: readiness must not be judged by port alone)", () => {
  it("resolves down immediately when the spawned server exits before answering health checks", async () => {
    const server = new EventEmitter();
    const fetchFn = vi.fn().mockResolvedValue({ ok: false });
    const sleepFn = vi.fn().mockImplementation(() => {
      // Simulate the child dying while the launcher is between polls.
      server.emit("exit", 1, null);
      return Promise.resolve();
    });
    const result = await waitForReady({
      url: "http://x",
      server,
      fetchFn,
      sleepFn,
      attempts: 5,
      delayMs: 0,
    });
    expect(result.up).toBe(false);
    expect(result.reason).toMatch(/exited before it became ready/);
    expect(result.reason).toMatch(/code 1/);
  });

  it("resolves down immediately when the spawned server errors", async () => {
    const server = new EventEmitter();
    const fetchFn = vi.fn().mockResolvedValue({ ok: false });
    const sleepFn = vi.fn().mockImplementation(() => {
      server.emit("error", new Error("EADDRINUSE"));
      return Promise.resolve();
    });
    const result = await waitForReady({
      url: "http://x",
      server,
      fetchFn,
      sleepFn,
      attempts: 5,
      delayMs: 0,
    });
    expect(result.up).toBe(false);
    expect(result.reason).toMatch(/EADDRINUSE/);
  });

  it("resolves up once the health check succeeds and the server is still alive", async () => {
    const server = new EventEmitter();
    let calls = 0;
    const fetchFn = vi.fn().mockImplementation(async () => ({ ok: ++calls >= 2 }));
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await waitForReady({
      url: "http://x",
      server,
      fetchFn,
      sleepFn,
      attempts: 5,
      delayMs: 0,
    });
    expect(result).toEqual({ up: true });
  });

  it("times out with a reason instead of resolving silently when nothing ever answers", async () => {
    const server = new EventEmitter();
    const fetchFn = vi.fn().mockResolvedValue({ ok: false });
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const result = await waitForReady({
      url: "http://x",
      server,
      fetchFn,
      sleepFn,
      attempts: 3,
      delayMs: 0,
    });
    expect(result.up).toBe(false);
    expect(result.reason).toMatch(/timed out/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

describe("e2eTarget (E2E_PORT: a second lane runs e2e beside port 3000)", () => {
  it("defaults to port 3000 when E2E_PORT is unset or blank", () => {
    for (const env of [{}, { E2E_PORT: "" }]) {
      expect(e2eTarget(env)).toEqual({
        port: "3000",
        origin: "http://localhost:3000",
        healthUrl: "http://localhost:3000/api/v1/health",
      });
    }
  });

  it("uses E2E_PORT for the server, origin and health check", () => {
    expect(e2eTarget({ E2E_PORT: "3100" })).toEqual({
      port: "3100",
      origin: "http://localhost:3100",
      healthUrl: "http://localhost:3100/api/v1/health",
    });
  });

  it("rejects an E2E_PORT that is not an integer from 1 to 65535", () => {
    for (const bad of ["0", "65536", "abc", "31.5", "-1", " 3100"]) {
      expect(() => e2eTarget({ E2E_PORT: bad })).toThrow(/E2E_PORT/);
    }
  });
});
