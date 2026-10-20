// Usage (in the app container, from the host's deploy directory; docs/deploy.md):
//   docker compose run --rm app node scripts/ops/config-import.js --dry-run
//   docker compose run --rm app node scripts/ops/config-import.js --admin admin@example.test
//   docker compose restart app
// #792 CFG-4: publishes the image's site config (SITE_CONFIG, else the bundled default, as boot
// reads it) on a seeded store as the next version, through the builder's publish path, with the
// normal configPublished row by the named admin. --dry-run prints the changes and writes nothing;
// --replace-draft replaces an existing shared draft. The published label overlay is kept. This
// process publishes; the running app serves the old version until `docker compose restart app`.
// Exit 0 published, unchanged or dry run; 2 usage error; 1 refused or failed (stderr: keys only).
import {
  type ConfigImportArgs,
  importReport,
  importSiteConfig,
  parseConfigImportArgs,
  refusalLines,
} from "../../packages/api/src/ops/config-import";
import { loadDeps } from "../../packages/api/src/startup";

let args: ConfigImportArgs;
try {
  args = parseConfigImportArgs(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : "usage error"}\n`);
  process.exit(2);
}
const deps = await loadDeps(process.env, { logSink: () => {} });
try {
  const r = await importSiteConfig(deps, {
    file: args.file ?? deps.env.siteConfigFile,
    adminEmail: args.adminEmail ?? "",
    dryRun: args.dryRun,
    replaceDraft: args.replaceDraft,
  });
  for (const line of importReport(r, args)) process.stdout.write(`${line}\n`);
} catch (e) {
  for (const line of refusalLines(e)) process.stderr.write(`${line}\n`);
  process.exitCode = 1;
} finally {
  deps.db.$client.close();
}
