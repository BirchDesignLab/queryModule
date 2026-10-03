import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule, toPosixRel } from "./cli-io";
import {
  type ConfigIo,
  ConfigUnreadableError,
  checkConfigFile,
  configTargets,
} from "./config-files";

// Re-exported for existing call sites/tests (item 2): the shared
// implementation now lives in cli-io.ts (review Q1/C6).
export { toPosixRel } from "./cli-io";

export const VALIDATE_USAGE = "usage: config:validate [--resolved] [--] [<file> ...]";
export const DIFF_MESSAGE = "config:validate: --diff arrives with M2 P2 (spec 7, 9.5)";

export type ParsedValidateArgs =
  | { ok: true; resolved: boolean; files: string[] }
  | { ok: false; message: string };

/**
 * Strict CLI parse: `--resolved` and file args. `--` ends option parsing, so a file whose
 * name starts with `--` can be named. `--diff` is an explicit reject until M2 P2 (#220 M3).
 */
export function parseValidateArgs(args: string[]): ParsedValidateArgs {
  let resolved = false;
  let optionsDone = false;
  const files: string[] = [];
  for (const a of args) {
    if (!optionsDone && a === "--") {
      optionsDone = true;
      continue;
    }
    if (!optionsDone && a === "--resolved") {
      resolved = true;
      continue;
    }
    if (!optionsDone && a === "--diff") return { ok: false, message: DIFF_MESSAGE };
    if (!optionsDone && a.startsWith("--"))
      return {
        ok: false,
        message: `unknown option ${a}\n${VALIDATE_USAGE}`,
      };
    files.push(a);
  }
  return { ok: true, resolved, files };
}

/**
 * The CLI's file io. Only ENOENT reads as missing; any other read error (EACCES, ENOTDIR, EISDIR,
 * an invalid path) is ConfigUnreadableError, as in the API loader (Task 7 ruling, wave review G-M1).
 * Invalid JSON throws a SyntaxError, which the checker reports as config.invalidJson.
 */
export function configIo(
  readText: (path: string) => string = (p) => readFileSync(p, "utf8"),
): ConfigIo {
  return {
    readJson: (p) => {
      let text: string;
      try {
        text = readText(p);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new ConfigUnreadableError();
      }
      return JSON.parse(text);
    },
  };
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

  const io = configIo();

  let failed = false;
  for (const file of targets) {
    const report = checkConfigFile(file, io);
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

if (isMainModule(import.meta.url, process.argv[1])) main();
