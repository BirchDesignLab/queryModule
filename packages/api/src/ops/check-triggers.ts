import { DatabaseLockTimeoutError, DatabaseOpenError, type Db } from "../db/client";
import {
  checkAuditTriggers,
  checkConfigVersionTriggers,
  checkQueryTriggers,
  TriggerMissingError,
} from "../db/migrate";
import { DeployEnvError } from "../env";
import { errorFields } from "../log/error-fields";
import { SecretConfigError } from "../secrets";
import { openForOps } from "./audit-stats";

/** Errors whose message is fixed text: trigger names, env variable names, secret file names. */
const FIXED_TEXT_ERRORS = [
  TriggerMissingError,
  DeployEnvError,
  SecretConfigError,
  DatabaseOpenError,
  DatabaseLockTimeoutError,
];

interface Writable {
  write(chunk: string): unknown;
}

/**
 * Spec 9.3 step 11 boot-smoke check: asserts every audit_event trigger exists and is unaltered,
 * then every query_request and source_result trigger, then every site_config_version trigger:
 * the three sets server startup checks (deps.ts; #279 G-m1, M1 phase review AUD-4).
 * Returns 0 when they are, 1 otherwise (never throws); always closes the client it opens via
 * openForOps. Stderr gets a fixed-text error's message, else only the error's name and fixed code
 * (spec 5.9, M1 phase review Q3): a query error's message quotes its params.
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
    const f = errorFields(e, FIXED_TEXT_ERRORS);
    err.write(`${f.message ?? `trigger check failed: ${f.name}${f.code ? ` ${f.code}` : ""}`}\n`);
    return 1;
  } finally {
    db?.$client.close();
  }
}
