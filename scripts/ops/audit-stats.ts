// Usage: node scripts/ops/audit-stats.js [--up-to <id>]   prints {"auditCount":n,"auditMaxId":m}
import { auditStats, openForOps } from "../../packages/api/src/ops/audit-stats";

const i = process.argv.indexOf("--up-to");
const upTo = i > 0 ? Number.parseInt(process.argv[i + 1] ?? "", 10) : undefined;
const { db } = await openForOps(process.env);
try {
  process.stdout.write(
    `${JSON.stringify(await auditStats(db, Number.isFinite(upTo) ? upTo : undefined))}\n`,
  );
} finally {
  db.$client.close();
}
