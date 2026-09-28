import { type Db, openDatabase } from "../db/client";
import { type DeployEnv, readDeployEnv } from "../env";
import { loadSecrets, type Secrets } from "../secrets";

export interface AuditStats {
  auditCount: number;
  auditMaxId: number;
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
