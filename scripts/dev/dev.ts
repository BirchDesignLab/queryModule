// Usage: node scripts/dev/dev.ts [--api-only]
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDevSecrets } from "./secrets.ts";

const root = resolve(import.meta.dirname, "../..");
const dev = resolve(root, ".dev");
// Siblings, not nested: secrets.ts refuses to start when SECRETS_DIR sits inside DATA_DIR (spec 5.5, 8.2).
const dataDir = resolve(dev, "data");
const secretsDir = resolve(dev, "secrets");
ensureDevSecrets(secretsDir);
const env = {
  ...process.env,
  NODE_ENV: "development",
  PUBLIC_ORIGIN: "http://localhost:5173",
  PORT: "3000",
  DATA_DIR: dataDir,
  SECRETS_DIR: secretsDir,
  ALLOW_MOCK_SOURCES: "true",
};
const run = (cmd: string, args: string[]) =>
  spawn(cmd, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
const children = [run("pnpm", ["exec", "tsx", "watch", "packages/api/src/main.ts"])];
if (!process.argv.includes("--api-only")) children.push(run("pnpm", ["dev:web"]));

const marker = resolve(dev, "seeded");
const seedScript = resolve(root, "scripts/ops/seed.ts");
if (!existsSync(marker) && existsSync(seedScript)) {
  for (let i = 0; i < 60; i++) {
    const ok = await fetch("http://localhost:3000/api/v1/health").then(
      (r) => r.ok,
      () => false,
    );
    if (ok) {
      const seed = run("pnpm", ["exec", "tsx", "scripts/ops/seed.ts"]);
      seed.on("exit", (code) => {
        if (code === 0) writeFileSync(marker, new Date().toISOString());
      });
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
