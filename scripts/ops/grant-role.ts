// Usage (in the app container): node scripts/ops/grant-role.js <email> <user|trainingOfficer|admin> [--revoke]
// Roles change only through this script; it writes roleChanged (spec 5.6, 4.7). A grant of a held
// role, or a revoke from a user-role user, changes and audits nothing.
import { grantRole, parseGrantRoleArgs } from "../../packages/api/src/ops/grant-role";
import { loadDeps } from "../../packages/api/src/startup";

let args: ReturnType<typeof parseGrantRoleArgs>;
try {
  args = parseGrantRoleArgs(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : "usage error"}\n`);
  process.exit(2);
}
const deps = await loadDeps(process.env, { logSink: () => {} });
try {
  const r = await grantRole(deps, args);
  process.stdout.write(`role for ${args.email} is ${r.changed ? "now" : "already"} ${r.role}\n`);
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : "grant-role failed"}\n`);
  process.exitCode = 1;
} finally {
  deps.db.$client.close();
}
