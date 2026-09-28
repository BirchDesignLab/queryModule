import type { Db } from "../db/client";
import { checkAuditTriggers } from "../db/migrate";
import { openForOps } from "./audit-stats";

interface Writable {
  write(chunk: string): unknown;
}

/**
 * Spec 9.3 step 11 boot-smoke check: asserts both audit_event triggers exist and are unaltered.
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
    out.write("audit_event triggers present\n");
    return 0;
  } catch (e) {
    err.write(`${e instanceof Error ? e.message : "trigger check failed"}\n`);
    return 1;
  } finally {
    db?.$client.close();
  }
}
