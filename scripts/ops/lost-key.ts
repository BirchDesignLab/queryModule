// Lost CREDENTIAL_KEY runbook (spec 8.7). The startup canary fails and the app refuses to serve.
// 1. Confirm the offline copy of CREDENTIAL_KEY is also lost.
// 2. Provision a new CREDENTIAL_KEY secret file (openssl rand -base64 32; owner 10001, mode 400).
// 3. Run with the new key mounted: docker compose run --rm --no-deps app node scripts/ops/lost-key.js --confirm-offline-copy-lost
//    P1: rewrites the credential canary. From M3 P1 it also deletes every state_credential row (credentialsInvalidated, keyLost)
//    and revokes active delegations (delegationRevoked, keyLost). Ends with wal_checkpoint(TRUNCATE).
// 4. Start the app. Users see credentialsMissing and re-enter credentials.
// It never touches request_key, query values or payloads.
import { systemClock } from "../../packages/api/src/clock";
import { checkAuditTriggers } from "../../packages/api/src/db/migrate";
import { openForOps } from "../../packages/api/src/ops/audit-stats";
import { recoverLostKey } from "../../packages/api/src/ops/lost-key";

if (!process.argv.includes("--confirm-offline-copy-lost")) {
  process.stderr.write(
    "refusing: pass --confirm-offline-copy-lost after checking the offline copy (runbook step 1)\n",
  );
  process.exit(2);
}
const { db, secrets } = await openForOps(process.env);
try {
  await checkAuditTriggers(db);
  await recoverLostKey(db, systemClock, "credential", secrets.credentialKey);
  process.stdout.write("credential canary rewritten under the new CREDENTIAL_KEY\n");
} finally {
  db.$client.close();
}
