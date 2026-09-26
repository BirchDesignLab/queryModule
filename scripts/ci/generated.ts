export const GENERATED_FILES = [
  "packages/api/openapi.json",
  "packages/core/contracts/ws-events.schema.json",
  "packages/config/schema/site-config.schema.json",
];
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
