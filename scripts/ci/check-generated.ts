import { spawnSync } from "node:child_process";

export const GENERATED_FILES = [
  "packages/api/openapi.json",
  "packages/core/contracts/ws-events.schema.json",
  "packages/config/schema/site-config.schema.json",
];
const GENERATORS: string[][] = [["contracts:gen"]];

const shell = process.platform === "win32";
for (const args of GENERATORS) {
  const r = spawnSync("pnpm", args, { stdio: "inherit", shell });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8" }).stdout.trim();
const changed = git(["diff", "--name-only", "--", ...GENERATED_FILES]);
const untracked = git(["ls-files", "--others", "--exclude-standard", "--", ...GENERATED_FILES]);
if (changed !== "" || untracked !== "") {
  console.error("Generated files differ from the committed copies. Run the generators and commit:");
  if (changed) console.error(changed);
  if (untracked) console.error(untracked);
  process.exit(1);
}
console.log("generated files match");
