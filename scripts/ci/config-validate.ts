import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TOKEN_NAMES } from "@querymodule/tokens";
import { type ConfigIo, checkConfigFile, configTargets } from "./config-files";

export const VALIDATE_USAGE = "usage: config:validate [--resolved] [<file> ...]";

export type ParsedValidateArgs =
  | { ok: true; resolved: boolean; files: string[] }
  | { ok: false; message: string };

/** Strict CLI parse: `--resolved` and bare file args, nothing else (item 1). */
export function parseValidateArgs(args: string[]): ParsedValidateArgs {
  let resolved = false;
  const files: string[] = [];
  for (const a of args) {
    if (a === "--resolved") {
      resolved = true;
      continue;
    }
    if (a.startsWith("--")) return { ok: false, message: `unknown option ${a}\n${VALIDATE_USAGE}` };
    files.push(a);
  }
  return { ok: true, resolved, files };
}

/** Forward slashes on every platform, so PowerShell and Git Bash print byte-identical
 * output (item 2). Takes an already-computed relative path, so it stays a pure string
 * function testable with either separator style regardless of the host OS. */
export function toPosixRel(relPath: string): string {
  return relPath.replaceAll("\\", "/");
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const cwd = process.env.INIT_CWD ?? process.cwd();

  const parsed = parseValidateArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.message);
    process.exit(2);
  }
  const printResolved = parsed.resolved;
  const explicit = parsed.files.map((a) => resolve(cwd, a));

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
    const rel = toPosixRel(relative(root, file));
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
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
