import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONFIG_SCHEMA_VERSION, migrateConfig } from "@querymodule/core/config";

/** Forward slashes on every platform (item 2), a pure string function so it is
 * testable with either separator style regardless of the host OS. */
export function toPosixRel(relPath: string): string {
  return relPath.replaceAll("\\", "/");
}

export type ReadJsonResult = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Reads and JSON-parses `path` via `readFile`, turning fs and JSON errors into
 * a short reason with no raw stack trace and no file excerpt: JSON.parse
 * messages can quote file content, so its message text is never printed
 * (item 3).
 */
export function readJsonFile(readFile: (path: string) => string, path: string): ReadJsonResult {
  let text: string;
  try {
    text = readFile(path);
  } catch (e) {
    const reason =
      (e as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
        ? "file not found"
        : "cannot read file";
    return { ok: false, reason };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const argRaw = process.argv[2];
  if (!argRaw) {
    console.error("usage: pnpm config:migrate <file>");
    process.exit(2);
  }
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), argRaw);
  const rel = toPosixRel(relative(root, path));

  const read = readJsonFile((p) => readFileSync(p, "utf8"), path);
  if (!read.ok) {
    console.error(`${rel}: ${read.reason}`);
    process.exit(1);
  }

  const result = migrateConfig(read.value);
  if (!result.ok) {
    console.error(
      `ERROR ${rel} ${result.error.path} ${result.error.key} ${JSON.stringify(result.error.params)}`,
    );
    process.exit(1);
  }
  if (result.applied.length === 0) {
    console.log(`${rel}: already at schema version ${CONFIG_SCHEMA_VERSION}`);
    process.exit(0);
  }
  for (const step of result.applied) console.warn(`migrated ${rel}: ${step.from} -> ${step.to}`);
  writeFileSync(path, `${JSON.stringify(result.config, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
