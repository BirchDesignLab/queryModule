// Usage (app container, called by backup.sh): node scripts/ops/backup.js /backup/<stamp>
import { systemClock } from "../../packages/api/src/clock";
import { openForOps } from "../../packages/api/src/ops/audit-stats";
import { takeBackup } from "../../packages/api/src/ops/backup";

// The real outDir-outside-data-dir guard lives in takeBackup itself (critic:C1), checked
// against the resolved data directory rather than a raw argv prefix.
const out = process.argv[2];
if (!out) {
  process.stderr.write("usage: backup <outDir outside the data dir>\n");
  process.exit(2);
}
const { env, db } = await openForOps(process.env);
try {
  const m = await takeBackup(db, env.dbFile, out, systemClock);
  process.stdout.write(
    `backup written: ${m.files.map((f) => f.name).join(", ")}; audit rows ${m.auditCount}, max id ${m.auditMaxId}\n`,
  );
} finally {
  db.$client.close();
}
