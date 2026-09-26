import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLicences, parseLicenceExceptions, parseLicenceReport } from "./licences";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: tsx scripts/ci/check-licences.ts <pnpm-licenses.json>");
  process.exit(2);
}
const exceptionsPath = resolve(root, ".github/licence-exceptions.json");
let report: ReturnType<typeof parseLicenceReport>;
let exceptions: ReturnType<typeof parseLicenceExceptions>;
try {
  report = parseLicenceReport(JSON.parse(readFileSync(resolve(reportPath), "utf8")));
} catch (err) {
  console.error(`${resolve(reportPath)}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
try {
  exceptions = parseLicenceExceptions(JSON.parse(readFileSync(exceptionsPath, "utf8")));
} catch (err) {
  console.error(`${exceptionsPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
const violations = checkLicences(report, exceptions);
if (violations.length > 0) {
  console.error(
    "Runtime dependencies outside the licence allowlist (add a reviewed entry to .github/licence-exceptions.json or remove the dependency):",
  );
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
const count = Object.values(report).reduce((n, list) => n + list.length, 0);
console.log(`licences ok (${count} runtime packages)`);
