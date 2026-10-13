import type { SiteConfig } from "@querymodule/core/config";
import {
  type QueryDetail,
  QueryDetailSchema,
  SubmitQueryResponseSchema,
} from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import { manualTime } from "../helpers/manual-time";
import { openResults } from "../helpers/results";
import { createTestApp } from "../helpers/test-app";

/*
 * GET /api/v1/queries/:correlationId, the owner's read (spec 5.1, 5.2, 5.5; FR-043, FR-044,
 * FR-062 read half, FR-065; SEC-010, SEC-014; #561). Mock data only: ZZ-0001 and TESTERSON are
 * the shipped mock's scenario values (spec 5.4, 10.8).
 */
const PASSWORD = "correct-horse-battery-1";
const EMAIL = "reader@example.test";
const PLATE = "ZZ-0001";
const LAST = "TESTERSON";

async function setup(o: { site?: (c: SiteConfig) => void } = {}) {
  const time = manualTime();
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
  });
  if (o.site) {
    const siteConfig = structuredClone(t.deps.config.current().siteConfig);
    o.site(siteConfig);
    t.deps.config.swap({ ...t.deps.config.current(), siteConfig });
  }
  await t.createUser(EMAIL, PASSWORD);
  const cookie = await t.cookieFor(EMAIL, PASSWORD);
  const { configHash } = t.deps.config.current();
  async function submit(body: Record<string, unknown>) {
    const r = await t.request("/api/v1/queries", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-requested-with": "querymodule",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ ...body, configHash }),
    });
    expect(r.status).toBe(202);
    return SubmitQueryResponseSchema.parse(await r.json());
  }
  /** Lets every adapter answer and T2 commit (the mock's maximum latency is 800 ms). */
  async function settleAll() {
    await time.run(10_000);
    await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
  }
  const get = (correlationId: string) =>
    t.request(`/api/v1/queries/${correlationId}`, { headers: { cookie } });
  async function read(correlationId: string): Promise<QueryDetail> {
    const r = await get(correlationId);
    expect(r.status).toBe(200);
    return QueryDetailSchema.parse(await r.json());
  }
  const count = async (sql: string, args: string[]) =>
    Number((await t.deps.db.$client.execute({ sql, args })).rows[0]?.n ?? -1);
  return { t, time, submit, settleAll, get, read, count };
}

const requireDob = (c: SiteConfig) => {
  const dob = c.queryTypes.find((q) => q.code === "WNT")?.fields.find((f) => f.key === "dob");
  if (!dob) throw new Error("WNT dob missing");
  dob.required = true;
};

describe("GET /api/v1/queries/:correlationId, the owner's read (spec 5.1, 5.2; #561)", () => {
  it("a settled ZZ-0001 submit: both sources returned with the generator's payload and the values", async () => {
    const { t, submit, settleAll, read } = await setup();
    const ack = await submit({
      queryType: "VEH",
      values: { plate: PLATE, state: "TX" },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
    });
    await settleAll();
    const detail = await read(ack.correlationId);
    expect(detail.correlationId).toBe(ack.correlationId);
    expect(detail.submittedAt).toBeLessThanOrEqual(ack.acknowledgedAt);
    expect(detail.configHash).toBe(t.deps.config.current().configHash);
    expect(detail.parts).toHaveLength(1);
    const part = detail.parts[0];
    expect(part).toMatchObject({
      partId: 0,
      parentPartId: null,
      origin: "primary",
      queryType: "VEH",
      plateOnly: false,
      skipReasons: [],
      droppedSourceIds: [],
      purged: false,
      values: { plate: PLATE, state: "TX" },
    });
    // selection order, as the 202 lists them
    expect(part?.sources.map((s) => [s.sourceId, s.status, s.purged])).toEqual([
      ["stateSource", "returned", false],
      ["nationalSource", "returned", false],
    ]);
    const opened = await openResults(t, ack.correlationId);
    for (const s of part?.sources ?? []) {
      expect(s.payload).toEqual(opened.find((o) => o.sourceId === s.sourceId)?.payload);
      expect(s).toMatchObject({ adapterKind: "mock", errorCode: null, timedOutAt: null });
      expect(s.receivedAt).not.toBeNull();
    }
    expect(part?.sources[0]?.payload).toMatchObject({ plate: PLATE, status: "STOLEN" });
    // no log line carries a value or a payload (spec 5.9)
    expect(t.logLines.join("\n")).not.toContain(PLATE);
    expect(t.logLines.join("\n")).not.toContain("STOLEN");
  });

  it("a pending source has no payload", async () => {
    const { submit, read } = await setup();
    const ack = await submit({
      queryType: "VEH",
      values: { plate: PLATE, state: "TX" },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
    });
    const detail = await read(ack.correlationId);
    const sources = detail.parts[0]?.sources ?? [];
    expect(sources.map((s) => s.status)).toEqual(["pending", "pending"]);
    for (const s of sources) {
      expect(s).not.toHaveProperty("payload");
      expect(s).toMatchObject({ purged: false, receivedAt: null });
    }
    expect(detail.parts[0]?.values).toEqual({ plate: PLATE, state: "TX" });
  });

  it("a skipped part carries its skipReasons and no values (#576)", async () => {
    const { submit, settleAll, read } = await setup({ site: requireDob });
    const ack = await submit({
      queryType: "PER",
      values: { last: LAST },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
    });
    await settleAll();
    const detail = await read(ack.correlationId);
    expect(detail.parts.map((p) => [p.partId, p.parentPartId, p.origin, p.queryType])).toEqual([
      [0, null, "primary", "PER"],
      [1, 0, "alsoRun", "WNT"],
    ]);
    expect(detail.parts[0]?.values).toMatchObject({ last: LAST });
    const skipped = detail.parts[1];
    expect(skipped?.skipReasons).toEqual(ack.parts[1]?.skipReasons);
    expect(skipped?.skipReasons).toEqual([
      { key: "validation.required", params: { field: "dob" } },
    ]);
    expect(skipped).not.toHaveProperty("values");
    expect(skipped).toMatchObject({ purged: false, sources: [] });
  });

  it("after the request keys are shredded (as lost-key does) the read is 200 with purged: true", async () => {
    const { t, submit, settleAll, read } = await setup();
    const ack = await submit({
      queryType: "VEH",
      values: { plate: PLATE, state: "TX" },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
    });
    await settleAll();
    await t.deps.db.$client.execute("DELETE FROM request_key");
    const detail = await read(ack.correlationId);
    const part = detail.parts[0];
    expect(part?.purged).toBe(true);
    expect(part).not.toHaveProperty("values");
    for (const s of part?.sources ?? []) {
      expect(s).toMatchObject({ status: "returned", purged: true });
      expect(s).not.toHaveProperty("payload");
    }
  });

  it("a failed (FAIL1) and a timed-out (TIMEOUT) source read without a payload (AW2 review C-m1)", async () => {
    const { submit, time, settleAll, read } = await setup();
    // FAIL1: stateSource fails; nationalSource answers its default
    const failed = await submit({
      queryType: "VEH",
      values: { plate: "FAIL1", state: "TX" },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
    });
    // TIMEOUT: nationalSource never answers; its deadline is ack + timeoutMs (10 000 ms)
    const timedOut = await submit({
      queryType: "VEH",
      values: { plate: "TIMEOUT", state: "TX" },
      sourceIds: ["nationalSource"],
      mode: "normal",
    });
    await time.run(20_000);
    await settleAll();
    const f = (await read(failed.correlationId)).parts[0]?.sources ?? [];
    expect(f.map((s) => [s.sourceId, s.status])).toEqual([
      ["stateSource", "failed"],
      ["nationalSource", "returned"],
    ]);
    expect(f[0]).toMatchObject({ errorCode: "failed", timedOutAt: null, purged: false });
    expect(f[0]).not.toHaveProperty("payload");
    expect(f[1]?.payload).toBeTypeOf("object");
    const t = (await read(timedOut.correlationId)).parts[0]?.sources ?? [];
    expect(t.map((s) => [s.sourceId, s.status])).toEqual([["nationalSource", "timedOut"]]);
    expect(t[0]).toMatchObject({ purged: false });
    // the outcome writer stamps both at settle (dispatch/outcome.ts)
    expect(t[0]?.timedOutAt).toBeTypeOf("number");
    expect(t[0]?.receivedAt).toBe(t[0]?.timedOutAt);
    expect(t[0]).not.toHaveProperty("payload");
  });

  it("each request_key scope purges on its own clock: payload shredded keeps values, and the reverse (AW2 review C-m2)", async () => {
    const { t, submit, settleAll, read } = await setup();
    const body = {
      queryType: "VEH",
      values: { plate: PLATE, state: "TX" },
      sourceIds: ["stateSource"],
      mode: "normal",
    };
    const a = await submit(body);
    const b = await submit(body);
    await settleAll();
    const shred = (correlationId: string, scope: "values" | "payload") =>
      t.deps.db.$client.execute({
        sql: "DELETE FROM request_key WHERE correlation_id = ? AND scope = ?",
        args: [correlationId, scope],
      });
    await shred(a.correlationId, "payload");
    await shred(b.correlationId, "values");
    const pa = (await read(a.correlationId)).parts[0];
    expect(pa).toMatchObject({ purged: false, values: { plate: PLATE, state: "TX" } });
    expect(pa?.sources[0]).toMatchObject({ status: "returned", purged: true });
    expect(pa?.sources[0]).not.toHaveProperty("payload");
    const pb = (await read(b.correlationId)).parts[0];
    expect(pb?.purged).toBe(true);
    expect(pb).not.toHaveProperty("values");
    expect(pb?.sources[0]).toMatchObject({ status: "returned", purged: false });
    expect(pb?.sources[0]?.payload).toMatchObject({ plate: PLATE, status: "STOLEN" });
  });

  it("the owner's read writes no audit row (spec 5.2)", async () => {
    const { submit, settleAll, read, count } = await setup();
    const ack = await submit({
      queryType: "VEH",
      values: { plate: PLATE, state: "TX" },
      sourceIds: ["stateSource"],
      mode: "normal",
    });
    await settleAll();
    const sql = "SELECT COUNT(*) AS n FROM audit_event";
    const before = await count(sql, []);
    await read(ack.correlationId);
    await read(ack.correlationId);
    expect(await count(sql, [])).toBe(before);
  });
});
