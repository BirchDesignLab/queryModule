// Keystroke-cost measurement (opt-in, not a gate): node scripts/perf/e2e-perf.ts [playwright args]
//
// Same server, seed and Playwright run as `pnpm e2e` (scripts/dev/e2e.ts), but the web app is built
// unminified with React's profiling renderer (react-dom/profiling), so apps/web/e2e/perf.spec.ts can
// read each commit's render time from the DevTools hook and take a CPU profile with readable names.
// The build goes to .dev/perf-dist (git-ignored); the normal apps/web/dist is untouched.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { e2eTarget, probeHealth, runSeed, waitForReady } from "../dev/e2e-lib.ts";
import { ensureDevSecrets } from "../dev/secrets.ts";

const root = resolve(import.meta.dirname, "../..");
const webDir = resolve(root, "apps/web");
const secrets = resolve(root, ".dev/secrets");
ensureDevSecrets(secrets);
const shell = process.platform === "win32";
const target = e2eTarget(process.env);

const b = spawnSync("pnpm", ["--filter", "@querymodule/api", "build"], {
  cwd: root,
  stdio: "inherit",
  shell,
});
if (b.status !== 0) process.exit(b.status ?? 1);

const perfDist = resolve(root, ".dev/perf-dist");
const requireFromWeb = createRequire(resolve(webDir, "package.json"));
// vite is a dependency of apps/web, not of the root: load it from there, typed by what is used.
const vite = (await import(pathToFileURL(requireFromWeb.resolve("vite")).href)) as {
  loadConfigFromFile(
    env: { command: "build"; mode: string },
    file: string,
    root: string,
  ): Promise<{ config: Record<string, unknown> } | null>;
  mergeConfig(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown>;
  build(config: Record<string, unknown>): Promise<unknown>;
};
const loaded = await vite.loadConfigFromFile(
  { command: "build", mode: "production" },
  resolve(webDir, "vite.config.ts"),
  webDir,
);
if (loaded === null) throw new Error("apps/web/vite.config.ts not found");
await vite.build(
  vite.mergeConfig(loaded.config, {
    root: webDir,
    configFile: false,
    logLevel: "warn",
    resolve: { alias: { "react-dom/client": "react-dom/profiling" } },
    build: { outDir: perfDist, emptyOutDir: true, minify: false },
  }),
);

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
  WEB_DIST: perfDist,
};
if (await probeHealth(target.healthUrl)) {
  console.error(`perf: port ${target.port} is already in use; stop the server or set E2E_PORT`);
  process.exit(1);
}
const server = spawn("node", ["packages/api/dist/main.js"], { cwd: root, env, stdio: "inherit" });
const { up, reason } = await waitForReady({ url: target.healthUrl, server });
if (!up) {
  console.error(`perf: server did not become ready: ${reason ?? "unknown reason"}`);
  server.kill("SIGTERM");
  process.exit(1);
}
const seed = runSeed({
  seedJsPath: resolve(root, "packages/api/dist/ops/seed.js"),
  cwd: root,
  env,
});
if (!seed.ok) {
  console.error(`perf: seed step failed: ${seed.reason}`);
  server.kill("SIGTERM");
  process.exit(1);
}
const args = process.argv.slice(2);
const pw = spawnSync(
  "pnpm",
  ["--filter", "@querymodule/web", "exec", "playwright", "test", "perf", ...args],
  {
    cwd: root,
    stdio: "inherit",
    shell,
    env: {
      ...process.env,
      QM_PERF: "1",
      QM_BASE_URL: target.origin,
      E2E_BASE_URL: target.origin,
      SEED_PASSWORD_SECRET_FILE: resolve(secrets, "SEED_PASSWORD_SECRET"),
    },
  },
);
server.kill("SIGTERM");
process.exit(pw.status ?? 1);
