import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const GENERATED_FILES = [
  "packages/api/openapi.json",
  "packages/core/contracts/ws-events.schema.json",
  "packages/config/schema/site-config.schema.json",
];
const GENERATORS: string[][] = [["contracts:gen"]];

export type GitResult = { status: number | null; stdout: string };
export type DriftResult =
  | { ok: true }
  | { ok: false; reason: "git-failed" | "drift"; files: string[] };

const lines = (s: string): string[] =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

/**
 * Compare the generated files with the committed copies. Fails closed: a git
 * call that exits non-zero (dubious ownership, no .git, git missing) is a
 * failure, never a pass (spec 9.3 step 7 gate).
 */
export function findDrift(runGit: (args: string[]) => GitResult): DriftResult {
  const calls = [
    ["diff", "--name-only", "--", ...GENERATED_FILES],
    ["ls-files", "--others", "--exclude-standard", "--", ...GENERATED_FILES],
  ];
  const files: string[] = [];
  for (const args of calls) {
    const r = runGit(args);
    if (r.status !== 0) return { ok: false, reason: "git-failed", files: [] };
    files.push(...lines(r.stdout));
  }
  return files.length === 0 ? { ok: true } : { ok: false, reason: "drift", files };
}

function main(): void {
  const shell = process.platform === "win32";
  for (const args of GENERATORS) {
    const r = spawnSync("pnpm", args, { stdio: "inherit", shell });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const result = findDrift((args) => {
    const r = spawnSync("git", args, { encoding: "utf8" });
    return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
  });
  if (result.ok) {
    console.log("generated files match");
    return;
  }
  if (result.reason === "git-failed") {
    console.error("git failed; cannot check generated files");
  } else {
    console.error(
      "Generated files differ from the committed copies. Run the generators and commit:",
    );
    for (const f of result.files) console.error(f);
  }
  process.exit(1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
