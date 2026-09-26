export const LICENCE_ALLOWLIST = [
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "ISC",
] as const;

export interface LicenceException {
  package: string;
  licence: string;
  reason: string;
  /** MM-DD-YY */
  reviewed: string;
}

export type LicenceReport = Record<string, { name: string; versions?: string[] }[]>;

export function isAllowedExpression(expr: string): boolean {
  const cleaned = expr.replace(/[()]/g, "").trim();
  if (cleaned.includes(" AND ")) return cleaned.split(" AND ").every((p) => isAllowedExpression(p));
  if (cleaned.includes(" OR ")) return cleaned.split(" OR ").some((p) => isAllowedExpression(p));
  return (LICENCE_ALLOWLIST as readonly string[]).includes(cleaned);
}

export function checkLicences(
  report: LicenceReport,
  exceptions: readonly LicenceException[],
): string[] {
  const violations: string[] = [];
  for (const [licence, packages] of Object.entries(report)) {
    if (isAllowedExpression(licence)) continue;
    for (const p of packages) {
      if (exceptions.some((e) => e.package === p.name && e.licence === licence)) continue;
      violations.push(`${p.name}@${(p.versions ?? []).join(",")}: ${licence}`);
    }
  }
  return violations.sort();
}
