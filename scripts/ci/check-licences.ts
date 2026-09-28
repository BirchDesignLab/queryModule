import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkLicences, parseLicenceExceptions, parseLicenceReport } from "./licences";

/** Forward slashes on every platform (item 2/8), a pure string function. */
export function toPosixRel(relPath: string): string {
  return relPath.replaceAll("\\", "/");
}

/** A short `<path>: <reason>` with no raw stack and no file excerpt: a JSON.parse
 * message can quote file content, so its own message text is never printed
 * (item 8, same convention as config:migrate's readJsonFile). */
export function readAndParse(
  readFile: () => string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  let text: string;
  try {
    text = readFile();
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
  const reportArg = process.argv[2];
  if (!reportArg) {
    console.error("usage: tsx scripts/ci/check-licences.ts <pnpm-licenses.json>");
    process.exit(2);
  }
  const reportPath = resolve(reportArg);
  const exceptionsPath = resolve(root, ".github/licence-exceptions.json");
  const reportRel = toPosixRel(relative(root, reportPath));
  const exceptionsRel = toPosixRel(relative(root, exceptionsPath));

  const reportRead = readAndParse(() => readFileSync(reportPath, "utf8"));
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

  const exceptionsRead = readAndParse(() => readFileSync(exceptionsPath, "utf8"));
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
