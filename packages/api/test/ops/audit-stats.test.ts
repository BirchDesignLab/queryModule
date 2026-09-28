import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { describe, expect, it } from "vitest";
import { withTransaction } from "../../src/db/tx";
import { auditStats } from "../../src/ops/audit-stats";
import { createTestApp } from "../helpers/test-app";

describe("SEC-010 audit stats", () => {
  it("counts rows and max id, optionally up to an id", async () => {
    const t = await createTestApp();
    expect(await auditStats(t.deps.db)).toEqual({ auditCount: 0, auditMaxId: 0 });
    for (let i = 0; i < 3; i++) {
      await withTransaction(t.deps.db, (tx) =>
        t.deps.audit.record(tx, {
          type: "loginFailed",
          actor: SYSTEM_ACTOR,
          identitySource: "system",
          details: { targetUserId: null, reason: "unknownAccount", clientIp: "local" },
        }),
      );
    }
    expect(await auditStats(t.deps.db)).toEqual({ auditCount: 3, auditMaxId: 3 });
    expect(await auditStats(t.deps.db, 2)).toEqual({ auditCount: 2, auditMaxId: 2 });
  });
});
