import { describe, expect, it } from "vitest";
import { readDeployEnv } from "../../src/env";
import { WS_UPGRADE_LIMIT } from "../../src/ws/limits";
import { WS_UPGRADE_LIMIT as fromServer } from "../../src/ws/server";

// D-A9 (spec 5.3): the default WebSocket upgrade limit is defined once, in the gate-tier
// ws/limits.ts (#574 G-G-m1, review G-M1), and is what the deploy env falls back to.
describe("the WebSocket upgrade default (D-A9)", () => {
  it("is 60 upgrades per client IP per 60 s", () => {
    expect(WS_UPGRADE_LIMIT).toEqual({ limit: 60, windowMs: 60_000 });
    expect(fromServer).toBe(WS_UPGRADE_LIMIT);
  });

  it("is the deploy env's fallback when WS_UPGRADE_LIMIT and WS_UPGRADE_WINDOW_MS are unset", () => {
    const env = readDeployEnv(
      { PUBLIC_ORIGIN: "https://q.example.test" },
      {
        configDir: "/app/config",
        migrationsDir: "/app/drizzle",
        webDist: "/app/web",
      },
    );
    expect(env.wsUpgradeLimit).toEqual(WS_UPGRADE_LIMIT);
  });
});
