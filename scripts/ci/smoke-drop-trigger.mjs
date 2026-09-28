// Boot-smoke helper only (#130 carry): drops one audit_event trigger directly, using the
// image's own @libsql/client and the throwaway DB_ENCRYPTION_KEY, so the ops check can prove
// check-triggers.js notices. Never run against a real database.
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const key = readFileSync("/run/secrets/DB_ENCRYPTION_KEY", "utf8").trim();
const client = createClient({
  url: "file:/data/querymodule.db",
  encryptionKey: key,
  concurrency: 1,
});
await client.execute("DROP TRIGGER audit_event_no_update");
client.close();
