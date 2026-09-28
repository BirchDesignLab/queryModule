import { type Db, openDatabase } from "../db/client";
import { type DeployEnv, readDeployEnv } from "../env";
import { loadSecrets, type Secrets } from "../secrets";

export interface AuditStats {
  auditCount: number;
  auditMaxId: number;
}

/**
 * Parses the `--up-to <id>` CLI flag (SEC-010: restore-test.sh compares audit_event only up
 * to the id the backup manifest counted). No `--up-to` anywhere in argv returns undefined; a
 * present `--up-to` must be followed by a non-negative integer argument matching /^\d+$/ that
 * is also a safe integer, or this throws a usage error instead of silently falling back to "no
 * limit" (critic:I1). Any other argument, including the unsupported `--up-to=<id>` form, is
 * rejected as unknown so a typo or a shell-quoting mistake fails loudly rather than being
 * ignored.
 */
export function parseUpTo(argv: string[]): number | undefined {
  const flagIndex = argv.indexOf("--up-to");
  for (const [i, arg] of argv.entries()) {
    if (flagIndex >= 0 && (i === flagIndex || i === flagIndex + 1)) continue;
    throw new Error(`usage: audit-stats [--up-to <id>] (unknown argument: ${arg})`);
  }
  if (flagIndex < 0) return undefined;
  const raw = argv[flagIndex + 1];
  if (raw === undefined || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error("usage: audit-stats [--up-to <id>]: value must be a non-negative integer");
  }
  return Number(raw);
}

export async function auditStats(db: Db, upToId?: number): Promise<AuditStats> {
  const r = await db.$client.execute({
    sql: "SELECT count(*) AS n, coalesce(max(id), 0) AS m FROM audit_event WHERE id <= ?",
    args: [upToId ?? Number.MAX_SAFE_INTEGER],
  });
  return { auditCount: Number(r.rows[0]?.n ?? 0), auditMaxId: Number(r.rows[0]?.m ?? 0) };
}

/**
 * Opens the database for an ops CLI: no migrations, no canary check, so the lost-key
 * runbooks and check-triggers work when a key canary fails (Task 34).
 */
export async function openForOps(
  processEnv: NodeJS.ProcessEnv,
): Promise<{ env: DeployEnv; secrets: Secrets; db: Db }> {
  const env = readDeployEnv(processEnv);
  const secrets = await loadSecrets(processEnv, env.secretsDir);
  const db = await openDatabase({ file: env.dbFile, encryptionKey: secrets.dbEncryptionKey });
  return { env, secrets, db };
}
