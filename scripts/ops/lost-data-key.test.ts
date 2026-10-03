import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #311 G-m1: the lost-data-key runbook checks the audit and the query table triggers, as server
// startup does, before it shreds anything.
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "lost-data-key.ts"),
  "utf8",
);

describe("lost-data-key runbook trigger checks", () => {
  it("checks audit and query triggers before recoverLostKey runs", () => {
    const shred = source.indexOf("await recoverLostKey(");
    const audit = source.indexOf("await checkAuditTriggers(db)");
    const query = source.indexOf("await checkQueryTriggers(db)");
    expect(audit).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(-1);
    expect(Math.max(audit, query)).toBeLessThan(shred);
  });
});
