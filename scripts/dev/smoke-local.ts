// Local smoke: builds, serves the production build the way `pnpm e2e` does (mock sources, fresh
// data dir, seeded demo users) and runs scripts/ops/smoke.sh against it. Steps 1 to 5 of the
// release gate (spec 8.7) without Docker. Usage: E2E_PORT=3200 node scripts/dev/smoke-local.ts
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
  WS_UPGRADE_LIMIT: process.env.WS_UPGRADE_LIMIT ?? "10000",
};
if (await probeHealth(target.healthUrl)) {
  console.error(`smoke-local: port ${target.port} is already in use; set E2E_PORT`);
  process.exit(1);
}
const server = spawn("node", ["packages/api/dist/main.js"], { cwd: root, env, stdio: "inherit" });
const { up, reason } = await waitForReady({ url: target.healthUrl, server });
if (!up) {
  console.error(`smoke-local: server did not become ready: ${reason ?? "unknown reason"}`);
  server.kill("SIGTERM");
  process.exit(1);
}
const seed = runSeed({
  seedJsPath: resolve(root, "packages/api/dist/ops/seed.js"),
  cwd: root,
  env,
});
if (!seed.ok) {
  console.error(`smoke-local: seed step failed: ${seed.reason}`);
  server.kill("SIGTERM");
  process.exit(1);
}
const smoke = spawnSync("bash", ["scripts/ops/smoke.sh", target.origin], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, SEED_PASSWORD_SECRET_FILE: resolve(secrets, "SEED_PASSWORD_SECRET") },
});
server.kill("SIGTERM");
process.exit(smoke.status ?? 1);
