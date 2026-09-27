import { resolve } from "node:path";
import { SYSTEM_ACTOR } from "@querymodule/core/contracts";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createAuditService } from "../../src/audit/service";
import { openDatabase } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { type Tx, withTransaction } from "../../src/db/tx";
import { TEST_DB_KEY, tempDbFile } from "../helpers/db";

async function fresh() {
  const db = await openDatabase({ file: tempDbFile(), encryptionKey: TEST_DB_KEY });
  await runMigrations(db, resolve(import.meta.dirname, "../../drizzle"));
  return db;
}
const actor = { id: "u1", email: "dispatcher@example.test", role: "user" as const };
const clock = { now: () => 1_790_000_000_000 };

describe("SEC-010 AuditService.record", () => {
  it("writes the envelope, assigns at, ids ascending", async () => {
    const db = await fresh();
    const audit = createAuditService(clock);
    const a = await withTransaction(db, (tx) =>
      audit.record(tx, {
        type: "logout",
        actor,
        identitySource: "local",
        details: { sessionId: "0199a0b0-0000-7000-8000-0000000000e1" },
      }),
    );
    const b = await withTransaction(db, (tx) =>
      audit.record(tx, {
        type: "loginFailed",
        actor: SYSTEM_ACTOR,
        identitySource: "system",
        details: { targetUserId: null, reason: "unknownAccount", clientIp: "203.0.113.9" },
      }),
    );
    expect(b.id).toBeGreaterThan(a.id);
    const row = (
      await db.$client.execute({ sql: "SELECT * FROM audit_event WHERE id = ?", args: [a.id] })
    ).rows[0];
    expect(row).toMatchObject({
      type: "logout",
      at: 1_790_000_000_000,
      actor_user_id: "u1",
      actor_email: "dispatcher@example.test",
      actor_role: "user",
      identity_source: "local",
    });
    expect(JSON.parse(String(row?.details))).toEqual({
      sessionId: "0199a0b0-0000-7000-8000-0000000000e1",
    });
  });

  it("rejects details outside the schema and rolls back the caller's writes", async () => {
    const db = await fresh();
    const audit = createAuditService(clock);
    await expect(
      withTransaction(db, async (tx) => {
        await tx.run(sql`INSERT INTO rate_limit (key, window_start, count) VALUES ('k', 1, 1)`);
        await audit.record(tx, {
          type: "logout",
          actor,
          identitySource: "local",
          details: { sessionId: "0199a0b0-0000-7000-8000-0000000000e1", password: "pw" },
        } as never);
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect((await db.$client.execute("SELECT count(*) AS n FROM rate_limit")).rows[0]?.n).toBe(0);
    expect((await db.$client.execute("SELECT count(*) AS n FROM audit_event")).rows[0]?.n).toBe(0);
  });

  it("throws when the insert returns no id", async () => {
    const audit = createAuditService(clock);
    const tx = {
      insert: () => ({ values: () => ({ returning: async () => [] }) }),
    } as unknown as Tx;
    await expect(
      audit.record(tx, {
        type: "logout",
        actor,
        identitySource: "local",
        details: { sessionId: "0199a0b0-0000-7000-8000-0000000000e1" },
      }),
    ).rejects.toThrow("audit insert returned no id");
  });
});
