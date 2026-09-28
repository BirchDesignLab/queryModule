// Usage (once, empty database): docker compose run --rm app node scripts/ops/seed.js
// Prints each demo password once to this command's stdout; never to the service log (spec 8.5).
import { readSecretFile } from "../../packages/api/src/secrets";
import { SeedPartialFailureError, seedUsers } from "../../packages/api/src/seed/seed";
import { loadDeps } from "../../packages/api/src/startup";

const deps = await loadDeps(process.env, { logSink: () => {} });
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
  if (e instanceof SeedPartialFailureError) {
    // Passwords for the users that did get created are only ever safe on this command's own
    // stdout (spec 5.9); print them before the non-secret failure line so they are not lost.
    process.stdout.write("email\trole\tpassword\n");
    for (const r of e.created) process.stdout.write(`${r.email}\t${r.role}\t${r.password}\n`);
    process.stderr.write(`${e.message}\n`);
  } else {
    process.stderr.write(`${e instanceof Error ? e.message : "seed failed"}\n`);
  }
  process.exitCode = 1;
} finally {
  deps.db.$client.close();
}
