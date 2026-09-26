import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_SCHEMA_VERSION, migrateConfig } from "@querymodule/core/config";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: pnpm config:migrate <file>");
  process.exit(2);
}
const path = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
const result = migrateConfig(JSON.parse(readFileSync(path, "utf8")));
if (!result.ok) {
  console.error(
    `ERROR ${arg} ${result.error.path} ${result.error.key} ${JSON.stringify(result.error.params)}`,
  );
  process.exit(1);
}
if (result.applied.length === 0) {
  console.log(`${arg}: already at schema version ${CONFIG_SCHEMA_VERSION}`);
  process.exit(0);
}
for (const step of result.applied) console.warn(`migrated ${arg}: ${step.from} -> ${step.to}`);
writeFileSync(path, `${JSON.stringify(result.config, null, 2)}\n`);
