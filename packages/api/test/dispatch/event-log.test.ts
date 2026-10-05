import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { SourceStatusEventSchema } from "@querymodule/core/contracts";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { withTransaction } from "../../src/db/tx";
import { appendEvent, type EventRow, latestSeq, pruneEventLog } from "../../src/dispatch/event-log";
import { openTempDatabase } from "../helpers/db";

// Spec 5.3, 5.5 (FR-043, FR-065, NFR-003): event_log is the per-user outbox; seq is the previous
// max for the user + 1, allocated inside the writer's transaction, and never restarts (D-A14).
const drizzleDir = resolve(import.meta.dirname, "../../drizzle");
const NOW = 1_790_000_000_000;
const HOUR = 60 * 60 * 1000;

async function fresh() {
  const db = await openTempDatabase();
  await runMigrations(db, drizzleDir);
  return db;
}

function row(userId: string, createdAt = NOW): EventRow {
  return {
    userId,
    type: "sourceStatus",
    correlationId: "0199a0b0-0000-7000-8000-0000000000c1",
    partId: 0,
    sourceId: "mock-src-1",
    resultId: "0199a0b0-0000-7000-8000-0000000000d1",
    status: "returned",
    createdAt,
  };
}

async function seqsOf(db: Awaited<ReturnType<typeof fresh>>, userId: string): Promise<number[]> {
  const r = await db.$client.execute({
    sql: "SELECT seq FROM event_log WHERE user_id = ? ORDER BY seq",
    args: [userId],
  });
  return r.rows.map((x) => Number(x.seq));
}

describe("event_log append and seq (spec 5.3, 5.5)", () => {
  it("two appends for one user give seq 1 then 2; another user starts at 1", async () => {
    const db = await fresh();
    const a = await withTransaction(db, (tx) => appendEvent(tx, row("u1")));
    const b = await withTransaction(db, (tx) => appendEvent(tx, row("u1")));
    const c = await withTransaction(db, (tx) => appendEvent(tx, row("u2")));
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 1]);
    expect(await seqsOf(db, "u1")).toEqual([1, 2]);
    expect(await seqsOf(db, "u2")).toEqual([1]);
  });

  it("returns a reference-only event that parses with SourceStatusEventSchema", async () => {
    const db = await fresh();
    const e = await withTransaction(db, (tx) => appendEvent(tx, row("u1")));
    expect(SourceStatusEventSchema.parse(e)).toEqual(e);
    expect(e).toEqual({
      v: 1,
      type: "sourceStatus",
      seq: 1,
      at: NOW,
      correlationId: "0199a0b0-0000-7000-8000-0000000000c1",
      partId: 0,
      sourceId: "mock-src-1",
      resultId: "0199a0b0-0000-7000-8000-0000000000d1",
      status: "returned",
    });
    const stored = await db.$client.execute("SELECT * FROM event_log");
    expect(stored.rows.map((r) => ({ ...r }))).toEqual([
      {
        user_id: "u1",
        seq: 1,
        type: "sourceStatus",
        correlation_id: "0199a0b0-0000-7000-8000-0000000000c1",
        part_id: 0,
        source_id: "mock-src-1",
        result_id: "0199a0b0-0000-7000-8000-0000000000d1",
        delegation_id: null,
        status: "returned",
        created_at: NOW,
      },
    ]);
  });

  it("an append in a rolled-back transaction leaves no row", async () => {
    const db = await fresh();
    await expect(
      withTransaction(db, async (tx) => {
        await appendEvent(tx, row("u1"));
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await seqsOf(db, "u1")).toEqual([]);
    const next = await withTransaction(db, (tx) => appendEvent(tx, row("u1")));
    expect(next.seq).toBe(1);
  });

  it("latestSeq is 0 with no rows, then the user's max", async () => {
    const db = await fresh();
    expect(await latestSeq(db, "u1")).toBe(0);
    await withTransaction(db, (tx) => appendEvent(tx, row("u1")));
    await withTransaction(db, (tx) => appendEvent(tx, row("u1")));
    await withTransaction(db, (tx) => appendEvent(tx, row("u2")));
    expect(await latestSeq(db, "u1")).toBe(2);
    expect(await latestSeq(db, "u2")).toBe(1);
    expect(await latestSeq(db, "u3")).toBe(0);
  });
});

describe("pruneEventLog (D-A14)", () => {
  it("deletes rows older than 24 h but keeps each user's newest row, so seq never restarts", async () => {
    const db = await fresh();
    await withTransaction(db, (tx) => appendEvent(tx, row("u1", NOW - 25 * HOUR)));
    await withTransaction(db, (tx) => appendEvent(tx, row("u1", NOW - HOUR)));
    // u2's only row is 25 h old: it stays as the seq high-water mark
    await withTransaction(db, (tx) => appendEvent(tx, row("u2", NOW - 25 * HOUR)));
    // u3's newest row is old too: only the older ones go
    await withTransaction(db, (tx) => appendEvent(tx, row("u3", NOW - 26 * HOUR)));
    await withTransaction(db, (tx) => appendEvent(tx, row("u3", NOW - 25 * HOUR)));

    const deleted = await withTransaction(db, (tx) => pruneEventLog(tx, NOW));
    expect(deleted).toBe(2);
    expect(await seqsOf(db, "u1")).toEqual([2]);
    expect(await seqsOf(db, "u2")).toEqual([1]);
    expect(await seqsOf(db, "u3")).toEqual([2]);

    const u1 = await withTransaction(db, (tx) => appendEvent(tx, row("u1")));
    const u2 = await withTransaction(db, (tx) => appendEvent(tx, row("u2")));
    const u3 = await withTransaction(db, (tx) => appendEvent(tx, row("u3")));
    expect([u1.seq, u2.seq, u3.seq]).toEqual([3, 2, 3]);
  });

  it("keeps a row exactly 24 h old and returns 0 when nothing is due", async () => {
    const db = await fresh();
    await withTransaction(db, (tx) => appendEvent(tx, row("u1", NOW - 24 * HOUR)));
    await withTransaction(db, (tx) => appendEvent(tx, row("u1", NOW)));
    expect(await withTransaction(db, (tx) => pruneEventLog(tx, NOW))).toBe(0);
    expect(await seqsOf(db, "u1")).toEqual([1, 2]);
  });

  it("has the (created_at) index from spec 5.5", async () => {
    const db = await fresh();
    const r = await db.run(
      sql`SELECT sql FROM sqlite_master WHERE name = 'event_log_created_at_idx'`,
    );
    expect(String(r.rows[0]?.sql)).toMatch(/ON `event_log` \(`created_at`\)/);
  });
});

describe("migrations", () => {
  it("check-audit-migrations passes with 0010_event_log", () => {
    const cli = resolve(import.meta.dirname, "../../../../scripts/ci/check-audit-migrations.ts");
    const out = execFileSync(process.execPath, [cli, drizzleDir], { encoding: "utf8" });
    expect(out).toMatch(/audit_event migrations ok \(11 files\)/);
  }, 20_000);
});
