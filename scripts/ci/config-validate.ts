import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKEN_NAMES } from "@querymodule/tokens";
import { type ConfigIo, checkConfigFile, configTargets } from "./config-files";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cwd = process.env.INIT_CWD ?? process.cwd();
const args = process.argv.slice(2);
const printResolved = args.includes("--resolved");
const explicit = args.filter((a) => !a.startsWith("--")).map((a) => resolve(cwd, a));
const listJson = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
const found = configTargets(explicit, () => [
  ...listJson(join(root, "packages/config/sites")),
  ...listJson(join(root, "packages/config/test")),
]);
if (!found.ok) {
  console.error(found.message);
  process.exit(1);
}
const targets = found.targets;

const io: ConfigIo = {
  readJson: (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined),
};

let failed = false;
for (const file of targets) {
  const report = checkConfigFile(file, io, { tokenNames: TOKEN_NAMES });
  const rel = relative(root, file);
  for (const d of report.errors)
    console.error(`ERROR ${rel} ${d.path || "/"} ${d.key} ${JSON.stringify(d.params)}`);
  for (const d of report.warnings)
    console.warn(`WARN ${rel} ${d.path} ${d.key} ${JSON.stringify(d.params)}`);
  if (report.errors.length > 0) failed = true;
  else console.log(`ok ${rel} (${report.warnings.length} warnings)`);
  if (printResolved && report.resolved !== undefined)
    console.log(JSON.stringify(report.resolved, null, 2));
}
process.exit(failed ? 1 : 0);
