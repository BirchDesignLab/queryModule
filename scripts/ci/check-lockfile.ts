import { readFileSync } from "node:fs";
import { checkLockfile, parseLockfileDocs } from "./lockfile";

const path = process.argv[2] ?? "pnpm-lock.yaml";

let text: string;
try {
  text = readFileSync(path, "utf8");
} catch (err) {
  console.error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

let docs: unknown[];
try {
  docs = parseLockfileDocs(text);
} catch (err) {
  console.error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

let result: ReturnType<typeof checkLockfile>;
try {
  result = checkLockfile(docs);
} catch (err) {
  console.error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

if (result.offenders.length > 0) {
  console.error(`${path} has a non-registry resolution (never printing the full value):`);
  for (const o of result.offenders) console.error(`  ${o.key}: ${o.kind}`);
  process.exit(1);
}
console.log(`lockfile ok (${result.packages} packages, registry only)`);
