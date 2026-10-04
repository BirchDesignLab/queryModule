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
    });
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
