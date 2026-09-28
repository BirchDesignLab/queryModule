// Usage: node scripts/ops/audit-stats.js [--up-to <id>]   prints {"auditCount":n,"auditMaxId":m}
import { auditStats, openForOps, parseUpTo } from "../../packages/api/src/ops/audit-stats";

let upTo: number | undefined;
try {
  upTo = parseUpTo(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : "usage: audit-stats [--up-to <id>]"}\n`);
  process.exit(2);
}
const { db } = await openForOps(process.env);
try {
  process.stdout.write(`${JSON.stringify(await auditStats(db, upTo))}\n`);
} finally {
  db.$client.close();
}
