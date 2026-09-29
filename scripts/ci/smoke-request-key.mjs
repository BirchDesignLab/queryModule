// Boot-smoke helper only (Task 12 carry, #279), using the image's own @libsql/client and the
// throwaway DB_ENCRYPTION_KEY. Never run against a real database.
//   node smoke-request-key.mjs seed    inserts 4 request_key rows (2 requests x the values and
//                                      payload scopes). The wrapped DEK bytes are placeholders:
//                                      the runbook deletes rows and never unwraps them.
//   node smoke-request-key.mjs check   after lost-data-key.js: request_key is empty and there is
//                                      one retentionPurged row per scope (reason keyLost,
//                                      olderThan null, system actor, 2 requests, 2 keys).
// Prints counts only: no key material, DEK or wrapped DEK bytes (spec 5.9).
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const mode = process.argv[2];
if (mode !== "seed" && mode !== "check") {
  process.stderr.write("usage: smoke-request-key.mjs seed|check\n");
  process.exit(2);
}
const key = readFileSync("/run/secrets/DB_ENCRYPTION_KEY", "utf8").trim();
const client = createClient({
  url: "file:/data/querymodule.db",
  encryptionKey: key,
  concurrency: 1,
});
const CIDS = ["01890a5d-ac96-774b-bcce-b302099a8057", "01890a5d-ac96-774b-bcce-b302099a8058"];
const SCOPES = ["values", "payload"];
try {
  if (mode === "seed") {
    for (const cid of CIDS) {
      for (const scope of SCOPES) {
        await client.execute({
          sql: "INSERT INTO request_key VALUES (?, ?, x'00', x'00', x'00', 1, 1790000000000)",
          args: [cid, scope],
        });
      }
    }
    process.stdout.write("request_key seeded: 4 keys for 2 requests\n");
  } else {
    const left = Number((await client.execute("SELECT count(*) AS n FROM request_key")).rows[0]?.n);
    if (left !== 0) throw new Error(`request_key still holds ${left} rows`);
    const rows = (
      await client.execute(
        "SELECT actor_user_id, actor_role, identity_source, details FROM audit_event WHERE type = 'retentionPurged' ORDER BY id",
      )
    ).rows;
    const scopes = [];
    for (const r of rows) {
      const d = JSON.parse(String(r.details));
      const ok =
        r.actor_user_id === "system" &&
        r.actor_role === "system" &&
        r.identity_source === "system" &&
        d.reason === "keyLost" &&
        d.olderThan === null &&
        d.requestCount === 2 &&
        d.keysDeleted === 2;
      if (!ok) throw new Error("a retentionPurged row does not match the keyLost shape");
      scopes.push(d.scope);
    }
    if (scopes.sort().join(",") !== "payload,values")
      throw new Error(`expected one retentionPurged per scope, found ${rows.length} rows`);
    process.stdout.write("request_key empty; one retentionPurged (keyLost) per scope\n");
  }
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : "request_key smoke check failed"}\n`);
  process.exitCode = 1;
} finally {
  client.close();
}
