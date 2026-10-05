import { SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { requestKey, sourceResult } from "../../src/db/schema";
import { open } from "../../src/keys/aead";
import { payloadAad, unwrapRequestKey } from "../../src/keys/request-keys";
import { TEST_SECRETS } from "../helpers/fixture";
import { manualTime } from "../helpers/manual-time";
import { createTestApp } from "../helpers/test-app";

// Spec 10.4 (FR-043): submits run end to end through the dispatcher, the shipped mock and T2.
// Story A4, server half: the terminal's "VEH ABC123" fills the site default state (TX), and that
// submit runs clean, every source terminal with a NO RECORD answer. The PER alsoRun WNT part is
// dispatched to nationalSource only and matches the mock's WANTED scenario on its own values.
// Mock data only: ABC123 and WANTED are the shipped mock's trigger values (spec 5.4, 10.8).
const PASSWORD = "correct-horse-battery-1";
const EMAIL = "scenarios@example.test";

async function setup() {
  const time = manualTime();
  const t = await createTestApp({
    clock: time.clock,
    timers: time.timers,
    monotonic: time.monotonic,
    random: () => 0,
  });
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
    const ack = SubmitQueryResponseSchema.parse(await r.json());
    // the mock's maximum latency is 800 ms; every deadline is 10 s
    await time.run(10_000);
    await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
    return ack;
  }
  /** Each row of the request with its sealed payload opened (null when none). */
  async function results(correlationId: string) {
    const [key] = await t.deps.db
      .select()
      .from(requestKey)
      .where(and(eq(requestKey.correlationId, correlationId), eq(requestKey.scope, "payload")));
    if (!key) throw new Error("no payload request key");
    const dek = unwrapRequestKey(TEST_SECRETS.dataKey, key);
    const rows = await t.deps.db
      .select()
      .from(sourceResult)
      .where(eq(sourceResult.correlationId, correlationId))
      .orderBy(asc(sourceResult.partId), asc(sourceResult.sourceId));
    return rows.map((r) => ({
      partId: r.partId,
      sourceId: r.sourceId,
      status: r.status,
      payload:
        r.payloadCiphertext && r.payloadIv && r.payloadTag
          ? (JSON.parse(
              open(
                dek,
                { ciphertext: r.payloadCiphertext, iv: r.payloadIv, tag: r.payloadTag },
                payloadAad(r.resultId),
              ).toString("utf8"),
            ) as unknown)
          : null,
    }));
  }
  return { t, submit, results };
}

describe("dispatch scenarios on the shipped mock (spec 10.4, FR-043)", () => {
  it("[A4] VEH ABC123 with the site default state runs clean", async () => {
    const { t, submit, results } = await setup();
    const state = t.deps.config.current().siteConfig.defaults.state;
    expect(state).toBe("TX");
    const ack = await submit({
      queryType: "VEH",
      values: { plate: "ABC123", state },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
    });
    expect(await results(ack.correlationId)).toEqual([
      {
        partId: 0,
        sourceId: "nationalSource",
        status: "returned",
        payload: { status: "NO RECORD" },
      },
      { partId: 0, sourceId: "stateSource", status: "returned", payload: { status: "NO RECORD" } },
    ]);
    expect(t.fatals).toEqual([]);
    expect(t.logLines.join("\n")).not.toContain("ABC123");
  });

  it("PER WANTED: part 1 (WNT, alsoRun) on nationalSource returns WANTED, part 0 does not", async () => {
    const { t, submit, results } = await setup();
    const ack = await submit({
      queryType: "PER",
      values: { last: "WANTED" },
      sourceIds: ["stateSource", "nationalSource"],
      mode: "normal",
    });
    expect(ack.parts.map((p) => [p.partId, p.queryType, p.sourceIds])).toEqual([
      [0, "PER", ["stateSource", "nationalSource"]],
      [1, "WNT", ["nationalSource"]],
    ]);
    const rows = await results(ack.correlationId);
    expect(rows.map((r) => [r.partId, r.sourceId, r.status])).toEqual([
      [0, "nationalSource", "returned"],
      [0, "stateSource", "returned"],
      [1, "nationalSource", "returned"],
    ]);
    for (const r of rows.filter((x) => x.partId === 0)) {
      expect(r.payload).toEqual({ status: "NO RECORD" });
    }
    expect(rows[2]?.payload).toMatchObject({ status: "WANTED", subject: { last: "SAMPLEWORTH" } });
    expect(t.fatals).toEqual([]);
    const logs = t.logLines.join("\n");
    expect(logs).not.toContain("WANTED");
    expect(logs).not.toContain("SAMPLEWORTH");
  });
});
