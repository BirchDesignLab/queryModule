import { type SubmitQueryResponse, SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { createTestApp } from "../helpers/test-app";

// Spec 10.4, NFR-002: parallel submits against the file-backed WAL database serialize through
// the IMMEDIATE transaction T1 without a SQLITE_BUSY reaching any caller.
const PASSWORD = "correct-horse-battery-1";
const USERS = 5;
const PER_USER = 4;

describe("POST /api/v1/queries concurrency (spec 10.4, NFR-002)", () => {
  it("20 parallel submits from 5 users each get a 202 with a full, ordered row set", async () => {
    const t = await createTestApp();
    const mode = (await t.deps.db.$client.execute("PRAGMA journal_mode")).rows[0];
    expect(String(Object.values(mode ?? {})[0]).toLowerCase()).toBe("wal");
    expect(t.env.dbFile).not.toBe(":memory:");

    // transactions asked for and not yet settled; after the gate opens only T1s start
    let inFlight = 0;
    let maxInFlight = 0;
    const cookies: string[] = [];
    for (let i = 0; i < USERS; i += 1) {
      const email = `dispatcher${i}@example.test`;
      await t.createUser(email, PASSWORD);
      cookies.push(await t.cookieFor(email, PASSWORD));
    }
    const { configHash } = (await (
      await t.request("/api/v1/config", { headers: { cookie: cookies[0] ?? "" } })
    ).json()) as { configHash: string };

    // Session resolution runs the requests nearly one at a time, so every submit is held after
    // its rate-limit hit until all 20 are there; released together, they contend for T1.
    const hit = t.deps.limiter.hit.bind(t.deps.limiter);
    let arrived = 0;
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    t.deps.limiter.hit = async (...args) => {
      const r = await hit(...args);
      arrived += 1;
      if (arrived === USERS * PER_USER) {
        maxInFlight = 0;
        open();
      }
      await gate;
      return r;
    };

    // commit order: T1 resolves with the 202 body only after its COMMIT
    const committed: string[] = [];
    const failures: unknown[] = [];
    const transaction = t.deps.db.transaction.bind(t.deps.db);
    vi.spyOn(t.deps.db, "transaction").mockImplementation((fn, config) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return transaction(fn, config)
        .finally(() => {
          inFlight -= 1;
        })
        .then(
          (r: unknown) => {
            const parsed = SubmitQueryResponseSchema.safeParse(r);
            if (parsed.success) committed.push(parsed.data.correlationId);
            return r as never;
          },
          (e: unknown) => {
            failures.push(e);
            throw e;
          },
        );
    });

    const posts = cookies.flatMap((cookie, u) =>
      Array.from({ length: PER_USER }, (_, k) =>
        t.request("/api/v1/queries", {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            "x-requested-with": "querymodule",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify(
            // alternate a one-part VEH and a two-part PER with its WNT check
            (u + k) % 2 === 0
              ? {
                  queryType: "VEH",
                  values: { plate: `ZZ-000${k}` },
                  sourceIds: ["stateSource", "nationalSource"],
                  mode: "plateOnly",
                  configHash,
                }
              : {
                  queryType: "PER",
                  values: { last: "Testerson" },
                  sourceIds: ["stateSource", "nationalSource"],
                  mode: "normal",
                  configHash,
                },
          ),
        }),
      ),
    );
    const responses = await Promise.all(posts);
    const texts = await Promise.all(responses.map((r) => r.text()));
    expect(responses.map((r) => r.status)).toEqual(Array(USERS * PER_USER).fill(202));
    for (const text of texts) expect(text).not.toContain("SQLITE_BUSY");
    expect(failures).toEqual([]);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(t.logLines.join("\n")).not.toContain("SQLITE_BUSY");
    const acks: SubmitQueryResponse[] = texts.map((s) =>
      SubmitQueryResponseSchema.parse(JSON.parse(s)),
    );
    expect(new Set(acks.map((a) => a.correlationId)).size).toBe(USERS * PER_USER);
    expect(committed.slice().sort()).toEqual(acks.map((a) => a.correlationId).sort());

    const rows = async (sql: string) => (await t.deps.db.$client.execute(sql)).rows;
    const parts = await rows("SELECT correlation_id, part_id FROM query_request");
    const results = await rows(
      "SELECT correlation_id, part_id, source_id, status FROM source_result",
    );
    const audit = await rows(
      "SELECT id, correlation_id, part_id, type FROM audit_event WHERE correlation_id IS NOT NULL ORDER BY id",
    );
    for (const ack of acks) {
      const cid = ack.correlationId;
      expect(
        parts
          .filter((p) => p.correlation_id === cid)
          .map((p) => Number(p.part_id))
          .sort((x, y) => x - y),
      ).toEqual(ack.parts.map((p) => p.partId));
      const mine = audit.filter((a) => a.correlation_id === cid);
      expect(mine.filter((a) => a.type === "acknowledged")).toHaveLength(1);
      expect(mine[mine.length - 1]?.type).toBe("acknowledged");
      for (const part of ack.parts) {
        expect(part.status).toBe("dispatched");
        expect(
          mine.filter((a) => a.type === "submitted" && Number(a.part_id) === part.partId),
        ).toHaveLength(1);
        const pending = results.filter(
          (r) => r.correlation_id === cid && Number(r.part_id) === part.partId,
        );
        expect(pending.map((r) => r.status)).toEqual(part.sourceIds.map(() => "pending"));
        expect(pending.map((r) => String(r.source_id)).sort()).toEqual(
          part.sourceIds.slice().sort(),
        );
      }
    }

    // audit ids strictly increase, and each request's rows form one block in commit order
    const ids = audit.map((a) => Number(a.id));
    for (let i = 1; i < ids.length; i += 1) expect(ids[i]).toBeGreaterThan(ids[i - 1] ?? Infinity);
    const blocks: string[] = [];
    for (const a of audit) {
      const cid = String(a.correlation_id);
      if (blocks[blocks.length - 1] !== cid) blocks.push(cid);
    }
    expect(blocks).toEqual(committed);
  }, 60_000);
});
