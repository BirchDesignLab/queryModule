// Usage: node scripts/ops/ack-stats.js [log-file]   (no argument: reads stdin)
// On the host: docker compose logs app --no-log-prefix | docker compose run --rm -T app node scripts/ops/ack-stats.js
// Summarizes the "metric ackReceipt" log lines (D-M2P2-4, NFR-004); the logic is in
// packages/api/src/ops/ack-stats.ts. Reads only; no values from the log are echoed.
import { runAckStats } from "../../packages/api/src/ops/ack-stats";

process.exitCode = await runAckStats(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
