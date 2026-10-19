// Usage (in the app container): node scripts/ops/add-demo-users.js
// #781: adds the DEMO_USERS an existing database lacks (the live demo is never reset, so seed.js
// refuses it). Existing accounts are left exactly as they are. Each creation writes userCreated
// (system actor, via add-demo-users) and each role grant roleChanged (via grant-role). Prints each
// new password once to this command's stdout, never to the service log (spec 8.5, 5.9).
import {
  AddDemoUsersPartialFailureError,
  addMissingDemoUsers,
  parseAddDemoUsersArgs,
} from "../../packages/api/src/ops/add-demo-users";
import { readSecretFile } from "../../packages/api/src/secrets";
import { loadDeps } from "../../packages/api/src/startup";

try {
  parseAddDemoUsersArgs(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : "usage error"}\n`);
  process.exit(2);
}
const deps = await loadDeps(process.env, { logSink: () => {} });
try {
  const secret = await readSecretFile(
    "SEED_PASSWORD_SECRET",
    process.env,
    deps.env.secretsDir,
    true,
  );
  const r = await addMissingDemoUsers(deps, secret as string);
  process.stdout.write("email\trole\tpassword\n");
  for (const u of r.created) process.stdout.write(`${u.email}\t${u.role}\t${u.password}\n`);
  process.stdout.write(
    `created ${r.created.length}, left ${r.existing.length} existing unchanged\n`,
  );
} catch (e) {
  if (e instanceof AddDemoUsersPartialFailureError) {
    // The accounts already made keep these passwords; this stdout is their only copy.
    process.stdout.write("email\trole\tpassword\n");
    for (const u of e.created) process.stdout.write(`${u.email}\t${u.role}\t${u.password}\n`);
  }
  process.stderr.write(`${e instanceof Error ? e.message : "add-demo-users failed"}\n`);
  process.exitCode = 1;
} finally {
  deps.db.$client.close();
}
