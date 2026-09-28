import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule, readJsonFile, toPosixRel } from "./cli-io";
import { checkLicences, parseLicenceExceptions, parseLicenceReport } from "./licences";

// Re-exported for existing call sites/tests (item 2/8): the shared
// implementation now lives in cli-io.ts (review Q1/C6) instead of a local
// copy (previously `readAndParse`, same shape as config-migrate's
// `readJsonFile`, now literally the same function).
export { toPosixRel } from "./cli-io";

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const reportArg = process.argv[2];
  if (!reportArg) {
    console.error("usage: tsx scripts/ci/check-licences.ts <pnpm-licenses.json>");
    process.exit(2);
  }
  const reportPath = resolve(reportArg);
  const exceptionsPath = resolve(root, ".github/licence-exceptions.json");
  const reportRel = toPosixRel(relative(root, reportPath));
  const exceptionsRel = toPosixRel(relative(root, exceptionsPath));

  const reportRead = readJsonFile((p) => readFileSync(p, "utf8"), reportPath);
  if (!reportRead.ok) {
    console.error(`${reportRel}: ${reportRead.reason}`);
    process.exit(1);
  }
  let report: ReturnType<typeof parseLicenceReport>;
  try {
    report = parseLicenceReport(reportRead.value);
  } catch (e) {
    console.error(`${reportRel}: ${e instanceof Error ? e.message : "invalid licence report"}`);
    process.exit(1);
  }

  const exceptionsRead = readJsonFile((p) => readFileSync(p, "utf8"), exceptionsPath);
  if (!exceptionsRead.ok) {
    console.error(`${exceptionsRel}: ${exceptionsRead.reason}`);
    process.exit(1);
  }
  let exceptions: ReturnType<typeof parseLicenceExceptions>;
  try {
    exceptions = parseLicenceExceptions(exceptionsRead.value);
  } catch (e) {
    console.error(
      `${exceptionsRel}: ${e instanceof Error ? e.message : "invalid licence exceptions"}`,
    );
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
}

if (isMainModule(import.meta.url, process.argv[1])) main();
