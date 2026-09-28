// Playwright against a local production build served by the API (master plan 9, 11).
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDevSecrets } from "./secrets.ts";

const root = resolve(import.meta.dirname, "../..");
const secrets = resolve(root, ".dev/secrets");
ensureDevSecrets(secrets);
const shell = process.platform === "win32";
for (const f of ["@querymodule/web", "@querymodule/api"]) {
  const b = spawnSync("pnpm", ["--filter", f, "build"], { cwd: root, stdio: "inherit", shell });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: "3000",
  PUBLIC_ORIGIN: "http://localhost:3000",
  DATA_DIR: mkdtempSync(resolve(root, ".dev/e2e-")),
  SECRETS_DIR: secrets,
  ALLOW_MOCK_SOURCES: "true",
  SITE_CONFIG: resolve(root, "packages/config/sites/default.json"),
  MIGRATIONS_DIR: resolve(root, "packages/api/drizzle"),
  WEB_DIST: resolve(root, "apps/web/dist"),
};
const server = spawn("node", ["packages/api/dist/main.js"], { cwd: root, env, stdio: "inherit" });
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await fetch("http://localhost:3000/api/v1/health").then(
    (r) => r.ok,
    () => false,
  );
  if (!up) await new Promise((r) => setTimeout(r, 1000));
}
let code = 1;
if (up) {
  spawnSync("node", ["packages/api/dist/ops/seed.js"], { cwd: root, env, stdio: "ignore" });
  const pw = spawnSync(
    "pnpm",
    ["--filter", "@querymodule/web", "exec", "playwright", "test", ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: "inherit",
      shell,
      env: {
        ...process.env,
        QM_BASE_URL: "http://localhost:3000",
        SEED_PASSWORD_SECRET_FILE: resolve(secrets, "SEED_PASSWORD_SECRET"),
      },
    },
  );
  code = pw.status ?? 1;
}
server.kill("SIGTERM");
process.exit(code);
