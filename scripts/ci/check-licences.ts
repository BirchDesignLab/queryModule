import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLicences, type LicenceException, type LicenceReport } from "./licences";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: tsx scripts/ci/check-licences.ts <pnpm-licenses.json>");
  process.exit(2);
}
const report = JSON.parse(readFileSync(resolve(reportPath), "utf8")) as LicenceReport;
const exceptions = JSON.parse(
  readFileSync(resolve(root, ".github/licence-exceptions.json"), "utf8"),
) as LicenceException[];
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
