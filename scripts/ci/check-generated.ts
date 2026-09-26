import { spawnSync } from "node:child_process";
import { findDrift } from "./generated";

// CLI entry for `pnpm gen:check`; runs unconditionally (no direct-execution guard to miss).
const GENERATORS = ["contracts:gen"];

// Windows resolves pnpm.cmd only through a shell; one command string avoids DEP0190.
for (const script of GENERATORS) {
  const r =
    process.platform === "win32"
      ? spawnSync(`pnpm ${script}`, { stdio: "inherit", shell: true })
      : spawnSync("pnpm", [script], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const result = findDrift((args) => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "" };
});
if (result.ok) {
  console.log("generated files match");
  process.exit(0);
}
if (result.reason === "git-failed") {
  console.error("git failed; cannot check generated files");
} else {
  console.error("Generated files differ from the committed copies. Run the generators and commit:");
  for (const f of result.files) console.error(f);
}
process.exit(1);
