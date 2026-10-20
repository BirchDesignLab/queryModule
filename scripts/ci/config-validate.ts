import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { diffConfig, renderChange } from "@querymodule/core/config";
import { isMainModule, toPosixRel } from "./cli-io";
import {
  type ConfigIo,
  ConfigUnreadableError,
  checkConfigFile,
  configTargets,
  mockDriftErrors,
} from "./config-files";

// Re-exported for existing call sites/tests (item 2): the shared
// implementation now lives in cli-io.ts (review Q1/C6).
export { toPosixRel } from "./cli-io";

export const VALIDATE_USAGE =
  "usage: config:validate [--resolved] [--diff <tag>] [--] [<file> ...]";

/** A tag or sha for --diff. It never starts with "-" (git would read it as an option). */
const TAG_PATTERN = /^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,99}$/;

export type ParsedValidateArgs =
  | { ok: true; resolved: boolean; files: string[]; diff?: string }
  | { ok: false; message: string };

/**
 * Strict CLI parse: `--resolved`, `--diff <tag>` and file args. `--` ends option parsing, so a
 * file whose name starts with `--` can be named. The tag is checked here, before any git call.
 */
export function parseValidateArgs(args: string[]): ParsedValidateArgs {
  let resolved = false;
  let optionsDone = false;
  let diff: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (!optionsDone && a === "--") {
      optionsDone = true;
      continue;
    }
    if (!optionsDone && a === "--resolved") {
      resolved = true;
      continue;
    }
    if (!optionsDone && a === "--diff") {
      const tag = args[++i];
      if (tag === undefined || !TAG_PATTERN.test(tag))
        return {
          ok: false,
          message: `--diff needs a tag or sha of letters, digits and ._/-
${VALIDATE_USAGE}`,
        };
      diff = tag;
      continue;
    }
    if (!optionsDone && a.startsWith("--"))
      return {
        ok: false,
        message: `unknown option ${a}\n${VALIDATE_USAGE}`,
      };
    files.push(a);
  }
  if (diff === undefined) return { ok: true, resolved, files };
  if (resolved)
    return {
      ok: false,
      message: `--resolved has no effect with --diff
${VALIDATE_USAGE}`,
    };
  return { ok: true, resolved, files, diff };
}

/** Reads `<tag>:<path>` (a git object spec) as text; undefined when the file is absent at the tag. */
export type ShowFile = (spec: string) => string | undefined;

/** A ConfigIo that serves every file as it was at `tag`, by its repo-relative posix path. */
export function tagIo(tag: string, root: string, show: ShowFile): ConfigIo {
  return {
    readJson: (p) => {
      const text = show(`${tag}:${toPosixRel(relative(root, p))}`);
      return text === undefined ? undefined : JSON.parse(text);
    },
  };
}

/**
 * True when a posix-style `relative(root, file)` result leaves the repo: a parent step, or an
 * absolute path (another drive or a UNC share on Windows, where `relative` cannot reach it).
 */
export function outsideRepo(rel: string): boolean {
  return rel === ".." || rel.startsWith("../") || win32.isAbsolute(rel) || posix.isAbsolute(rel);
}

type Exec = (file: string, args: readonly string[], options: object) => string;

/**
 * `git show` through execFile with an argument array: the spec is never seen by a shell. The C
 * locale keeps git's "does not exist in" text in English, which the absent-path check reads.
 */
export function gitShow(root: string, exec: Exec = execFileSync as Exec): ShowFile {
  return (spec) => {
    try {
      return exec("git", ["show", spec], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C", LANGUAGE: "C" },
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      // Only "the path is not in that commit" reads as absent; any other git failure is unreadable.
      const stderr = String((e as { stderr?: unknown }).stderr ?? "");
      if (/does not exist in|exists on disk, but not in/.test(stderr)) return undefined;
      throw new ConfigUnreadableError();
    }
  };
}

/**
 * The --diff output for each target: one line per change from the tag to the working tree
 * (`+` added, `-` removed, `~` changed or reordered), "new file" for a target absent at the tag,
 * and an ERROR line for any side that does not validate.
 */
export function diffLines(
  tag: string,
  targets: readonly string[],
  root: string,
  show: ShowFile,
  headIo: ConfigIo = configIo(),
): string[] {
  const out: string[] = [];
  const old = tagIo(tag, root, show);
  for (const file of targets) {
    const rel = toPosixRel(relative(root, file));
    if (outsideRepo(rel)) {
      out.push(`ERROR ${rel} / config.targetOutsideRepo {}`);
      continue;
    }
    let atTag = true;
    try {
      atTag = old.readJson(file) !== undefined;
    } catch {
      // Present but unreadable or invalid at the tag: checkConfigFile reports it below.
    }
    if (!atTag) {
      out.push(`${rel}: new file`);
      for (const d of checkConfigFile(file, headIo).errors)
        out.push(`ERROR ${rel} head ${d.path || "/"} ${d.key} ${JSON.stringify(d.params)}`);
      continue;
    }
    const before = checkConfigFile(file, old);
    const after = checkConfigFile(file, headIo);
    const bad = [
      ...before.errors.map((d) => ["tag", d] as const),
      ...after.errors.map((d) => ["head", d] as const),
    ];
    if (bad.length > 0) {
      for (const [side, d] of bad)
        out.push(`ERROR ${rel} ${side} ${d.path || "/"} ${d.key} ${JSON.stringify(d.params)}`);
      continue;
    }
    const changes = diffConfig(before.resolved, after.resolved);
    if (changes.length === 0) out.push(`${rel}: no changes`);
    else {
      out.push(`${rel}: ${changes.length} change${changes.length === 1 ? "" : "s"} since ${tag}`);
      for (const c of changes) out.push(renderChange(c));
    }
  }
  return out;
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

  if (parsed.diff !== undefined) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${parsed.diff}^{commit}`], {
        cwd: root,
        stdio: "ignore",
      });
    } catch {
      console.error(`config:validate: unknown tag or sha ${parsed.diff}`);
      process.exit(2);
    }
    const lines = diffLines(parsed.diff, targets, root, gitShow(root));
    for (const l of lines) (l.startsWith("ERROR ") ? console.error : console.log)(l);
    process.exit(lines.some((l) => l.startsWith("ERROR ")) ? 1 : 0);
  }

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
  // Generator drift is a repo-tree check: run it on the default (whole tree) run only.
  if (explicit.length === 0) {
    const drift = mockDriftErrors(join(root, "packages/config/mock"));
    for (const line of drift) console.error(`ERROR ${line}`);
    if (drift.length > 0) failed = true;
    else console.log("ok packages/config/mock (generator, no drift)");
  }
  process.exit(failed ? 1 : 0);
}

if (isMainModule(import.meta.url, process.argv[1])) main();
