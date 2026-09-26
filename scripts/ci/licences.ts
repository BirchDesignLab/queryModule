import { z } from "zod";

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

const licenceReportSchema = z.record(
  z.string(),
  z.array(
    z.object({ name: z.string().min(1), versions: z.array(z.string()).optional() }).passthrough(),
  ),
);

const licenceExceptionsSchema = z.array(
  z.object({
    package: z.string().min(1),
    licence: z.string().min(1),
    reason: z.string().min(1),
    reviewed: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-\d{2}$/, "MM-DD-YY"),
  }),
);

/** Validates `pnpm licenses list --prod --json` output. Fails closed: throws on a bad shape or zero packages. */
export function parseLicenceReport(raw: unknown): LicenceReport {
  const result = licenceReportSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`licence report has an unexpected shape: ${result.error.message}`);
  }
  const count = Object.values(result.data).reduce((n, list) => n + list.length, 0);
  if (count === 0) {
    throw new Error("licence report lists 0 runtime packages; expected at least 1");
  }
  return result.data;
}

/** Validates .github/licence-exceptions.json. */
export function parseLicenceExceptions(raw: unknown): LicenceException[] {
  const result = licenceExceptionsSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`licence exceptions have an unexpected shape: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Judges an SPDX expression against the allowlist.
 * Grammar: or := and ('OR' and)*; and := atom ('AND' atom)*; atom := '(' or ')' | id.
 * AND binds tighter than OR. A malformed expression (or WITH, which is not parsed) returns false.
 */
export function isAllowedExpression(expr: string): boolean {
  const tokens = expr.match(/[()]|[^\s()]+/g) ?? [];
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];

  const parseOr = (): boolean => {
    let value = parseAnd();
    while (peek() === "OR") {
      pos++;
      const rhs = parseAnd();
      value = value || rhs;
    }
    return value;
  };
  const parseAnd = (): boolean => {
    let value = parseAtom();
    while (peek() === "AND") {
      pos++;
      const rhs = parseAtom();
      value = value && rhs;
    }
    return value;
  };
  const parseAtom = (): boolean => {
    const token = peek();
    if (token === undefined || token === ")" || token === "AND" || token === "OR") {
      throw new Error("malformed SPDX expression");
    }
    pos++;
    if (token === "(") {
      const value = parseOr();
      if (peek() !== ")") throw new Error("malformed SPDX expression");
      pos++;
      return value;
    }
    return (LICENCE_ALLOWLIST as readonly string[]).includes(token);
  };

  try {
    const value = parseOr();
    return pos === tokens.length && value;
  } catch {
    return false;
  }
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
