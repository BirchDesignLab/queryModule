// Playwright against a local production build served by the API (master plan 9, 11).
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { e2eTarget, probeHealth, runSeed, waitForReady } from "./e2e-lib.ts";
import { ensureDevSecrets } from "./secrets.ts";

const root = resolve(import.meta.dirname, "../..");
const secrets = resolve(root, ".dev/secrets");
ensureDevSecrets(secrets);
const shell = process.platform === "win32";
const target = e2eTarget(process.env);
for (const f of ["@querymodule/web", "@querymodule/api"]) {
  const b = spawnSync("pnpm", ["--filter", f, "build"], { cwd: root, stdio: "inherit", shell });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: target.port,
  PUBLIC_ORIGIN: target.origin,
  DATA_DIR: mkdtempSync(resolve(root, ".dev/e2e-")),
  SECRETS_DIR: secrets,
  ALLOW_MOCK_SOURCES: "true",
  SITE_CONFIG: resolve(root, "packages/config/sites/default.json"),
  MIGRATIONS_DIR: resolve(root, "packages/api/drizzle"),
  WEB_DIST: resolve(root, "apps/web/dist"),
};
const healthUrl = target.healthUrl;

// C2: refuse to start against a port that already answers, rather than judging
// readiness later by a health check that could belong to someone else's server
// (e.g. an already-running `pnpm dev`/`pnpm dev:api`).
if (await probeHealth(healthUrl)) {
  console.error(
    `e2e: port ${target.port} is already in use; stop the existing server or set E2E_PORT`,
  );
  process.exit(1);
}

const server = spawn("node", ["packages/api/dist/main.js"], { cwd: root, env, stdio: "inherit" });

// C2: watch the spawned server itself so a dead/errored child is reported
// immediately instead of only after a 60s health-check timeout.
const { up, reason } = await waitForReady({ url: healthUrl, server });
if (!up) {
  console.error(`e2e: server did not become ready: ${reason ?? "unknown reason"}`);
  server.kill("SIGTERM");
  process.exit(1);
}

// C1: check the seed step's exit status and keep its stderr, instead of
// swallowing a failure and letting Playwright run against an unseeded database.
const seedResult = runSeed({
  seedJsPath: resolve(root, "packages/api/dist/ops/seed.js"),
  cwd: root,
  env,
});
if (!seedResult.ok) {
  console.error(`e2e: seed step failed: ${seedResult.reason}`);
  server.kill("SIGTERM");
  process.exit(1);
}

const pw = spawnSync(
  "pnpm",
  ["--filter", "@querymodule/web", "exec", "playwright", "test", ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    shell,
    env: {
      ...process.env,
      QM_BASE_URL: target.origin,
      E2E_BASE_URL: target.origin,
      SEED_PASSWORD_SECRET_FILE: resolve(secrets, "SEED_PASSWORD_SECRET"),
    },
  },
);
const code = pw.status ?? 1;
server.kill("SIGTERM");
process.exit(code);
