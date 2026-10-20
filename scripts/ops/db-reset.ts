// Usage (deploy host, app stopped; docs/deploy.md "Reset and reseed the demo database"):
//   docker compose run --rm -v qm-backup-staging:/backup app node scripts/ops/db-reset.js --confirm <site>
// #821, ADR-0015: backs up the demo database into /backup (outside /data), then deletes it,
// migrates a fresh one, runs the seed and add-demo-users. Refuses unless ALLOW_MOCK_SOURCES is on
// and the loaded site is mock only, --confirm names that site, the app service does not answer
// its health route and the database is not busy. Prints the backup file and each demo password
// once to this command's stdout, never to the service log (spec 5.9). DB_RESET_APP_HOST
// overrides the probe host (default app, the compose service name).
import { systemClock } from "../../packages/api/src/clock";
import { readDeployEnv } from "../../packages/api/src/env";
import {
  DB_RESET_USAGE,
  dbResetHealthUrl,
  parseDbResetArgs,
  runDbReset,
} from "../../packages/api/src/ops/db-reset";
import { readSecretFile } from "../../packages/api/src/secrets";
import { loadDeps } from "../../packages/api/src/startup";

const argv = process.argv.slice(2);
if (!parseDbResetArgs(argv)) {
  process.stderr.write(`${DB_RESET_USAGE}\n`);
  process.exit(2);
}
const env = readDeployEnv(process.env);
process.exitCode = await runDbReset(argv, {
  env,
  open: () => loadDeps(process.env, { logSink: () => {} }),
  seedSecret: async () =>
    (await readSecretFile("SEED_PASSWORD_SECRET", process.env, env.secretsDir, true)) as string,
  backupRoot: "/backup",
  healthUrl: dbResetHealthUrl(process.env.DB_RESET_APP_HOST ?? "app", env.port),
  clock: systemClock,
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
});
