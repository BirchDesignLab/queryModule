import { SubmitQueryResponseSchema, type WsEvent } from "@querymodule/core/contracts";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { SourceAdapter } from "../../src/adapters/types";
import { auditEvent, eventLog, sourceResult } from "../../src/db/schema";
import { manualTime } from "../helpers/manual-time";
import { createTestApp } from "../helpers/test-app";

// Story B1, API half (FR-043, FR-044; spec 10.4): two mock sources, one of which times out. The
// state source returns; the national source is timedOut at acknowledgedAt + its timeoutMs
// (10000, the shipped site config). An answer that settles after the deadline changes nothing:
// no second write, audit row, event or publish. Time is manual (no real sleeps).
const PASSWORD = "correct-horse-battery-1";
const EMAIL = "b1@example.test";
const LATE_MS = 15_000;

describe("[B1] multi-source query with per-source status: one source times out (FR-043, FR-044)", () => {
  it("[B1] stateSource returned, nationalSource timedOut at acknowledgedAt + 10000; a late settlement 5 s later changes nothing", async () => {
    const time = manualTime();
    // random 0: the mock's minimum latency, stateSource 50 ms
    const t = await createTestApp({
      clock: time.clock,
      timers: time.timers,
      monotonic: time.monotonic,
      random: () => 0,
    });
    const userId = await t.createUser(EMAIL, PASSWORD);
    const cookie = await t.cookieFor(EMAIL, PASSWORD);
    const published: WsEvent[] = [];
    t.deps.eventBus.subscribe(userId, (e) => published.push(e));

    // nationalSource ignores its abort signal and answers at 15 s, 5 s after its deadline
    const get = t.deps.adapters.get.bind(t.deps.adapters);
    vi.spyOn(t.deps.adapters, "get").mockImplementation((kind, snapshot) => {
      const real = get(kind, snapshot);
      const adapter: SourceAdapter = {
        query: (req, creds, signal) =>
          req.sourceId === "nationalSource"
            ? new Promise((resolve) => {
                t.deps.timers.setTimeout(() => resolve({ status: "NO RECORD" }), LATE_MS);
              })
            : real.query(req, creds, signal),
      };
      return adapter;
    });

    const r = await t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        queryType: "VEH",
        values: { plate: "TIMEOUT", state: "TX" },
        sourceIds: ["stateSource", "nationalSource"],
        mode: "normal",
        configHash: t.deps.config.current().configHash,
      }),
    });
    expect(r.status).toBe(202);
    const ack = SubmitQueryResponseSchema.parse(await r.json());
    const deadline = ack.acknowledgedAt + 10_000;
    const idle = () => vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));

    const rows = () =>
      t.deps.db
        .select()
        .from(sourceResult)
        .where(eq(sourceResult.correlationId, ack.correlationId))
        .orderBy(asc(sourceResult.sourceId));
    const responded = async () =>
      (
        await t.deps.db
          .select()
          .from(auditEvent)
          .where(eq(auditEvent.correlationId, ack.correlationId))
          .orderBy(asc(auditEvent.id))
      ).filter((a) => a.type === "sourceResponded");
    const events = () =>
      t.deps.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.userId, userId))
        .orderBy(asc(eventLog.seq));

    // one ms before the deadline: the state answer is in, the national row still pending
    await time.run(9_999);
    // the national job is still in flight, so wait on the state outcome's commit itself
    await vi.waitFor(async () =>
      expect((await rows()).map((x) => [x.sourceId, x.status])).toEqual([
        ["nationalSource", "pending"],
        ["stateSource", "returned"],
      ]),
    );
    expect(t.deps.dispatcher.inFlight()).toBe(1);

    await time.run(1);
    await idle();
    const atDeadline = await rows();
    expect(atDeadline.find((x) => x.sourceId === "stateSource")).toMatchObject({
      status: "returned",
      receivedAt: ack.acknowledgedAt + 50,
    });
    expect(atDeadline.find((x) => x.sourceId === "nationalSource")).toMatchObject({
      status: "timedOut",
      errorCode: null,
      payloadCiphertext: null,
      receivedAt: deadline,
      timedOutAt: deadline,
    });
    const auditAtDeadline = await responded();
    expect(auditAtDeadline.map((a) => (a.details as { status: string }).status)).toEqual([
      "returned",
      "timedOut",
    ]);
    const eventsAtDeadline = await events();
    expect(eventsAtDeadline.map((e) => [e.seq, e.sourceId, e.status])).toEqual([
      [1, "stateSource", "returned"],
      [2, "nationalSource", "timedOut"],
    ]);
    expect(published.map((e) => (e.type === "sourceStatus" ? [e.seq, e.status] : null))).toEqual([
      [1, "returned"],
      [2, "timedOut"],
    ]);

    // the national answer settles 5 s after the deadline: nothing changes
    await time.run(LATE_MS - 10_000);
    await idle();
    expect(await rows()).toEqual(atDeadline);
    expect(await responded()).toEqual(auditAtDeadline);
    expect(await events()).toEqual(eventsAtDeadline);
    expect(published).toHaveLength(2);
    expect(t.fatals).toEqual([]);
    const late = t.logLines.filter((l) => l.includes("dispatch late settlement"));
    expect(late).toHaveLength(1);
    const nationalId = atDeadline.find((x) => x.sourceId === "nationalSource")?.resultId;
    expect(JSON.parse(late[0] ?? "{}")).toMatchObject({
      resultId: nationalId,
      sourceId: "nationalSource",
    });
    expect(t.logLines.join("\n")).not.toContain("TIMEOUT");
    expect(t.logLines.join("\n")).not.toContain("NO RECORD");
  });
});
