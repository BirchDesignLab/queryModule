import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeployEnvError, readDeployEnv } from "../src/env";

const defaults = { configDir: "/app/config", migrationsDir: "/app/drizzle", webDist: "/app/web" };
const ORIGIN = "https://q.example.test";

describe("readDeployEnv", () => {
  it("applies defaults", () => {
    const e = readDeployEnv({ PUBLIC_ORIGIN: ORIGIN }, defaults);
    expect(e).toMatchObject({
      nodeEnv: "production",
      port: 3000,
      dataDir: "/data",
      // node:path join, as env.ts builds them, so the expectation holds on Windows too
      dbFile: join("/data", "querymodule.db"),
      secretsDir: "/run/secrets",
      siteConfigFile: join("/app/config", "sites/default.json"),
      identityModes: ["standalone"],
      allowMockSources: false,
      minClientVersion: null,
      corsOrigins: [ORIGIN],
      frameAncestors: [],
      webDist: "/app/web",
      wsUpgradeLimit: { limit: 60, windowMs: 60_000 },
    });
  });
  it("reads the WebSocket upgrade limit and window from the env (D-A9; e2e opens many sockets)", () => {
    const e = readDeployEnv(
      { PUBLIC_ORIGIN: ORIGIN, WS_UPGRADE_LIMIT: "1000", WS_UPGRADE_WINDOW_MS: "30000" },
      defaults,
    );
    expect(e.wsUpgradeLimit).toEqual({ limit: 1000, windowMs: 30_000 });
    expect(
      readDeployEnv(
        { PUBLIC_ORIGIN: ORIGIN, WS_UPGRADE_LIMIT: "", WS_UPGRADE_WINDOW_MS: "" },
        defaults,
      ).wsUpgradeLimit,
    ).toEqual({ limit: 60, windowMs: 60_000 });
    for (const bad of ["0", "-1", "1.5", "abc", " ", "1e3"]) {
      expect(() =>
        readDeployEnv({ PUBLIC_ORIGIN: ORIGIN, WS_UPGRADE_LIMIT: bad }, defaults),
      ).toThrow(new DeployEnvError("WS_UPGRADE_LIMIT must be a positive integer"));
      expect(() =>
        readDeployEnv({ PUBLIC_ORIGIN: ORIGIN, WS_UPGRADE_WINDOW_MS: bad }, defaults),
      ).toThrow(new DeployEnvError("WS_UPGRADE_WINDOW_MS must be a positive integer"));
    }
  });
  it("adds localhost origins only in development", () => {
    const dev = readDeployEnv(
      { NODE_ENV: "development", PUBLIC_ORIGIN: "http://localhost:5173" },
      defaults,
    );
    expect(dev.corsOrigins).toEqual(["http://localhost:5173", "http://localhost:3000"]);
  });
  it("rejects a missing PUBLIC_ORIGIN and an unknown identity mode", () => {
    expect(() => readDeployEnv({}, defaults)).toThrow(/PUBLIC_ORIGIN/);
    expect(() => readDeployEnv({ PUBLIC_ORIGIN: ORIGIN, IDENTITY_MODES: "sso" }, defaults)).toThrow(
      /IDENTITY_MODES/,
    );
  });
  it("parses lists and flags", () => {
    const e = readDeployEnv(
      {
        PUBLIC_ORIGIN: ORIGIN,
        ALLOW_MOCK_SOURCES: "true",
        IDENTITY_MODES: "standalone,embedded",
        CORS_ORIGINS: "https://a.example.test, https://b.example.test",
        MIN_CLIENT_VERSION: "1.2.0",
        PORT: "8080",
      },
      defaults,
    );
    expect(e.allowMockSources).toBe(true);
    expect(e.identityModes).toEqual(["standalone", "embedded"]);
    expect(e.corsOrigins).toEqual(["https://a.example.test", "https://b.example.test"]);
    expect(e.port).toBe(8080);
  });
  it("fails closed on a CORS_ORIGINS entry that is not an origin, naming the key, never the value", () => {
    for (const bad of [
      "https://a.example.test/",
      "https://a.example.test/app",
      "a.example.test",
      "ftp://a.example.test",
      "https://ok.example.test, null",
      // #822 G-m4: anything after the host and port is not an origin.
      "https://a.example.test?x=1",
      "https://a.example.test#top",
      "https://a.example test",
      "https://user@a.example.test",
      "https://a.example.test:99999",
      "https://A.example.test",
    ]) {
      let msg = "";
      try {
        readDeployEnv({ PUBLIC_ORIGIN: ORIGIN, CORS_ORIGINS: bad }, defaults);
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e);
      }
      expect(msg, bad).toMatch(/CORS_ORIGINS/);
      for (const part of bad.split(",")) expect(msg, bad).not.toContain(part.trim());
    }
    // Empty keeps the public origin; http and a port are origins.
    expect(
      readDeployEnv({ PUBLIC_ORIGIN: ORIGIN, CORS_ORIGINS: "" }, defaults).corsOrigins,
    ).toEqual([ORIGIN]);
    expect(
      readDeployEnv({ PUBLIC_ORIGIN: ORIGIN, CORS_ORIGINS: "http://localhost:5173" }, defaults)
        .corsOrigins,
    ).toEqual(["http://localhost:5173"]);
  });
  it("fails closed on a PORT that is not an integer from 1 to 65535 (spec 8.1)", () => {
    for (const PORT of ["abc", "0", "65536", "80.5", "3000abc", ""]) {
      expect(() => readDeployEnv({ PUBLIC_ORIGIN: ORIGIN, PORT }, defaults)).toThrow(/PORT/);
    }
  });
  it("WEB_DIST empty disables web serving", () => {
    expect(readDeployEnv({ PUBLIC_ORIGIN: ORIGIN, WEB_DIST: "" }, defaults).webDist).toBeNull();
  });
  it("throws a DeployEnvError with fixed text and no value in it (spec 5.9, M1 exit LS-2)", () => {
    const CANARY = "ZZENVCANARY0123";
    const cases: NodeJS.ProcessEnv[] = [
      { PUBLIC_ORIGIN: ORIGIN, PORT: CANARY },
      { PUBLIC_ORIGIN: CANARY },
      { PUBLIC_ORIGIN: ORIGIN, IDENTITY_MODES: CANARY },
    ];
    for (const env of cases) {
      let caught: unknown;
      try {
        readDeployEnv(env, defaults);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(DeployEnvError);
      expect((caught as Error).name).toBe("DeployEnvError");
      expect((caught as Error).message).not.toContain(CANARY);
    }
  });
});
