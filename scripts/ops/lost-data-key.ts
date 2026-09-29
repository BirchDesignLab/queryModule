// Lost DATA_KEY runbook (spec 8.7). The startup canary fails and the app refuses to serve.
// 1. Confirm the offline copy of DATA_KEY is also lost.
// 2. Provision a new DATA_KEY secret file (openssl rand -base64 32; owner 10001, mode 400).
// 3. Run with the new key mounted: docker compose run --rm --no-deps app node scripts/ops/lost-data-key.js --confirm-offline-copy-lost
//    P1: rewrites the data canary. From M1 P2 it also deletes every request_key row (the values and payloads they wrapped are
//    already unreadable) and writes one retentionPurged per scope with reason keyLost. Ends with wal_checkpoint(TRUNCATE).
// 4. Start the app. New submissions get fresh request_key rows; audit rows and metadata are unaffected.
// It never touches state_credential or delegations.

import { createAuditService } from "../../packages/api/src/audit/service";
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
  const r = await recoverLostKey(
    db,
    systemClock,
    "data",
    secrets.dataKey,
    createAuditService(systemClock),
  );
  process.stdout.write(
    `request_key shredded: ${r.keysDeleted} keys for ${r.requestCount} requests; data canary rewritten\n`,
  );
} finally {
  db.$client.close();
}
