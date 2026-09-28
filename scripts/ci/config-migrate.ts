import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_SCHEMA_VERSION, migrateConfig } from "@querymodule/core/config";
import { isMainModule, readJsonFile, toPosixRel } from "./cli-io";

export type { ReadJsonResult } from "./cli-io";
// Re-exported for existing call sites/tests (item 2/3): the shared
// implementation now lives in cli-io.ts (review Q1/C6) so config-migrate,
// check-licences and story-tags stop each carrying their own copy.
export { readJsonFile, toPosixRel } from "./cli-io";

/** Writes the migrated config; a failed write prints `<rel>: cannot write file` (never the raw error, which carries the absolute path) and returns false (#220 M1). */
export function writeConfigFile(path: string, rel: string, config: unknown): boolean {
  try {
    writeFileSync(
      path,
      `${JSON.stringify(config, null, 2)}
`,
    );
    return true;
  } catch {
    console.error(`${rel}: cannot write file`);
    return false;
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
  if (!writeConfigFile(path, rel, result.config)) process.exit(1);
}

if (isMainModule(import.meta.url, process.argv[1])) main();
