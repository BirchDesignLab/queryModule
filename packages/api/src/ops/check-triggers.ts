import type { Db } from "../db/client";
import { checkAuditTriggers, checkConfigVersionTriggers, checkQueryTriggers } from "../db/migrate";
import { openForOps } from "./audit-stats";

interface Writable {
  write(chunk: string): unknown;
}

/**
 * Spec 9.3 step 11 boot-smoke check: asserts every audit_event trigger exists and is unaltered,
 * then every query_request and source_result trigger, then every site_config_version trigger:
 * the three sets server startup checks (deps.ts; #279 G-m1, M1 phase review AUD-4).
 * Returns 0 when they are, 1 otherwise (never throws); always closes the client it opens via
 * openForOps.
 */
export async function runCheckTriggers(
  env: NodeJS.ProcessEnv,
  out: Writable,
  err: Writable,
): Promise<number> {
  let db: Db | undefined;
  try {
    ({ db } = await openForOps(env));
    await checkAuditTriggers(db);
    await checkQueryTriggers(db);
    await checkConfigVersionTriggers(db);
    out.write("audit_event, query table and site_config_version triggers present\n");
    return 0;
  } catch (e) {
    err.write(`${e instanceof Error ? e.message : "trigger check failed"}\n`);
    return 1;
  } finally {
    db?.$client.close();
  }
}
