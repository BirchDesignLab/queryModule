// Usage (in the app container): node scripts/ops/login-stats.js [--since <YYYY-MM-DD>]
// Prints sign-ins per account from the audit's loginSucceeded rows: count, distinct client IPs and
// the last sign-in (UTC). Read only; client IP values are never printed, only their count.

import { openForOps } from "../../packages/api/src/ops/audit-stats";
import {
  formatLoginStats,
  loginStats,
  parseLoginStatsArgs,
} from "../../packages/api/src/ops/login-stats";

let since: number | undefined;
try {
  ({ since } = parseLoginStatsArgs(process.argv.slice(2)));
} catch (e) {
  process.stderr.write(
    `${e instanceof Error ? e.message : "usage: login-stats [--since <YYYY-MM-DD>]"}\n`,
  );
  process.exit(2);
}
const { db } = await openForOps(process.env);
try {
  process.stdout.write(formatLoginStats(await loginStats(db, since)));
} finally {
  db.$client.close();
}
