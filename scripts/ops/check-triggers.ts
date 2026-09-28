// Usage: node scripts/ops/check-triggers.js   (CI boot smoke, spec 9.3 step 11). Exit 0 only when both audit_event triggers exist.
import { checkAuditTriggers } from "../../packages/api/src/db/migrate";
import { openForOps } from "../../packages/api/src/ops/audit-stats";

const { db } = await openForOps(process.env);
try {
  await checkAuditTriggers(db);
  process.stdout.write("audit_event triggers present\n");
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : "trigger check failed"}\n`);
  process.exitCode = 1;
} finally {
  db.$client.close();
}
