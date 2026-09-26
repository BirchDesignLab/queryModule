import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSensitiveReview } from "./sensitive-review";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const result = runSensitiveReview(process.env, {
  runGit: (args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (r.error) return { status: null, stdout: null, stderr: r.error.message };
    return { status: r.status, stdout: r.stdout ?? null, stderr: r.stderr ?? null };
  },
  readFile: (path) => {
    const abs = resolve(root, path);
    return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
  },
});
for (const m of result.messages) (result.code === 0 ? console.log : console.error)(m);
process.exit(result.code);
