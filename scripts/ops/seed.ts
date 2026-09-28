// Usage (once, empty database): docker compose run --rm app node scripts/ops/seed.js
// Prints each demo password once to this command's stdout; never to the service log (spec 8.5).
import { readSecretFile } from "../../packages/api/src/secrets";
import { seedUsers } from "../../packages/api/src/seed/seed";
import { bootstrap } from "../../packages/api/src/startup";

const deps = await bootstrap(process.env, { logSink: () => {} });
try {
  const secret = await readSecretFile(
    "SEED_PASSWORD_SECRET",
    process.env,
    deps.env.secretsDir,
    true,
  );
  const rows = await seedUsers(deps, secret as string);
  process.stdout.write("email\trole\tpassword\n");
  for (const r of rows) process.stdout.write(`${r.email}\t${r.role}\t${r.password}\n`);
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : "seed failed"}\n`);
  process.exitCode = 1;
} finally {
  deps.db.$client.close();
}
