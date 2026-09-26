import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listSensitiveChanges } from "./sensitive-review";

// Prints the sensitive files a PR touches, one per line (project-sync `sensitive-label` job).
// Reads BASE_SHA and HEAD_SHA; exits 2 on bad input or a git failure.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const result = listSensitiveChanges(process.env, {
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
for (const m of result.messages) console.error(m);
for (const f of result.files) console.log(f);
process.exit(result.code);
