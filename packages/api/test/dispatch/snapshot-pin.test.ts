import { type ConfigDocument, SubmitQueryResponseSchema } from "@querymodule/core/contracts";
import { describe, expect, it, vi } from "vitest";
import type { LoadedConfig } from "../../src/config/load";
import { grantRole } from "../../src/ops/grant-role";
import { ALL_ON, API, withSiteConfig } from "../helpers/admin-config";
import { manualTime } from "../helpers/manual-time";
import { openResults } from "../helpers/results";
import { createTestApp } from "../helpers/test-app";

// ADR-0011 item 3, spec 5.2 step 5 and 10.4 (FR-044): a job runs on the config snapshot pinned at
// prepare. A publish while the job waits in the dispatcher queue changes neither its deadline
// (the TIMEOUT source's timeoutMs) nor the mock it is answered from; a submit after the publish
// runs on the new version. Both of the pinned submit's jobs are queued across the publish (each
// source's cap is full), so the national one proves the deadline and the state one the mock.
// Mock data only: TIMEOUT and ZZ-#### plates (spec 5.4, 10.8).
const PASSWORD = "correct-horse-battery-1";
/** stateSource's VEH default in version 2, so an answer names the mock it came from. */
const V2_DEFAULT = { status: "NO RECORD", remarks: "VERSION TWO" };

interface MockShape {
  sources: Record<string, { responses: { queryType: string; default: unknown }[] }>;
}

describe("dispatch reads the snapshot pinned at prepare (ADR-0011 item 3, spec 10.4)", () => {
  it("a job queued across a publish keeps version 1's deadline and mock; a later submit uses version 2", async () => {
    const time = manualTime();
    // random 0: stateSource answers at 50 ms, nationalSource at 100 ms but never to TIMEOUT
    const t = await createTestApp({
      env: { SITE_CONFIG: ALL_ON },
      clock: time.clock,
      timers: time.timers,
      monotonic: time.monotonic,
      random: () => 0,
    });
    await t.createUser("dispatcher@example.test", PASSWORD);
    const cookie = await t.cookieFor("dispatcher@example.test", PASSWORD);
    await t.createUser("implementer@example.test", PASSWORD);
    await grantRole(t.deps, {
      email: "implementer@example.test",
      role: "implementer",
      change: "granted",
    });
    const implementer = await t.cookieFor("implementer@example.test", PASSWORD);
    const v1 = t.deps.config.current();
    expect(v1.siteConfig.sources.find((s) => s.id === "nationalSource")?.timeoutMs).toBe(10_000);

    const gets: LoadedConfig[] = [];
    const get = t.deps.adapters.get.bind(t.deps.adapters);
    vi.spyOn(t.deps.adapters, "get").mockImplementation((kind, snapshot) => {
      gets.push(snapshot);
      return get(kind, snapshot);
    });

    async function submit(plate: string, sourceIds: string[]) {
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
          values: { plate, state: "TX" },
          sourceIds,
          mode: "normal",
          configHash: t.deps.config.current().configHash,
        }),
      });
      expect(r.status).toBe(202);
      return SubmitQueryResponseSchema.parse(await r.json());
    }
    /** The request's rows (one part) with their payloads opened. */
    const rows = async (correlationId: string) =>
      (await openResults(t, correlationId)).map((r) => ({
        sourceId: r.sourceId,
        status: r.status,
        timedOutAt: r.timedOutAt,
        payload: r.payload,
      }));

    // four state-only and four national-only jobs fill both sources' caps (4), so both of the next
    // submit's jobs wait in the queue across the publish
    for (let k = 1; k <= 4; k += 1) await submit(`ZZ-000${k}`, ["stateSource"]);
    for (let k = 1; k <= 4; k += 1) await submit(`ZZ-010${k}`, ["nationalSource"]);
    const pinned = await submit("TIMEOUT", ["stateSource", "nationalSource"]);
    expect(gets).toHaveLength(8);
    expect(t.deps.dispatcher.inFlight()).toBe(10);

    // publish version 2 while that job is queued: nationalSource timeoutMs 2000, a changed mock
    const exported = await t.request(`${API}/versions/1/export`, {
      headers: { cookie: implementer, "x-requested-with": "querymodule" },
    });
    expect(exported.status).toBe(200);
    const edited: ConfigDocument = withSiteConfig(
      (await exported.json()) as ConfigDocument,
      (s) => {
        const sources = s.sources as { id: string; timeoutMs: number }[];
        for (const src of sources) if (src.id === "nationalSource") src.timeoutMs = 2_000;
      },
    );
    const mock = edited.mock as unknown as MockShape;
    const veh = mock.sources.stateSource?.responses.find((r) => r.queryType === "VEH");
    if (!veh) throw new Error("no stateSource VEH mock response");
    veh.default = V2_DEFAULT;
    const write = (method: string, path: string, body: unknown) =>
      t.request(path, {
        method,
        headers: {
          cookie: implementer,
          "content-type": "application/json",
          "x-requested-with": "querymodule",
        },
        body: JSON.stringify(body),
      });
    expect((await write("PUT", `${API}/draft`, { baseVersion: 1, document: edited })).status).toBe(
      200,
    );
    expect((await write("POST", `${API}/publish`, { draftVersion: 2 })).status).toBe(200);
    const v2 = t.deps.config.current();
    expect(v2.configHash).not.toBe(v1.configHash);
    expect(v2.siteConfig.sources.find((s) => s.id === "nationalSource")?.timeoutMs).toBe(2_000);
    expect(gets).toHaveLength(8);

    // the state answers (50 ms) free stateSource's cap, the national answers (100 ms)
    // nationalSource's: both queued jobs start after the publish, on version 1
    await time.run(50);
    await vi.waitFor(() => expect(gets).toHaveLength(9));
    await time.run(50);
    await vi.waitFor(() => expect(gets).toHaveLength(10));
    // identity, not equality: every call so far, the queued jobs' included, got version 1
    expect(gets.every((s) => s === v1)).toBe(true);
    const after = await submit("TIMEOUT", ["stateSource", "nationalSource"]);
    expect(gets).toHaveLength(12);
    expect(gets.slice(10).every((s) => s === v2)).toBe(true);

    // version 2's deadline (2 s from the later submit, ack + 2100 for the pinned one) passes: only
    // the later submit's national row times out; the pinned national job, queued across the
    // publish and started at ack + 100, keeps version 1's 10 s deadline
    await time.run(2_000);
    await vi.waitFor(async () =>
      expect((await rows(after.correlationId)).map((r) => r.status)).toEqual([
        "timedOut",
        "returned",
      ]),
    );
    expect(await rows(after.correlationId)).toEqual([
      {
        sourceId: "nationalSource",
        status: "timedOut",
        timedOutAt: after.acknowledgedAt + 2_000,
        payload: null,
      },
      { sourceId: "stateSource", status: "returned", timedOutAt: null, payload: V2_DEFAULT },
    ]);
    expect((await rows(pinned.correlationId)).map((r) => [r.sourceId, r.status])).toEqual([
      ["nationalSource", "pending"],
      ["stateSource", "returned"],
    ]);

    // version 1's deadline (10 s): the pinned job times out, its state answer from version 1's mock
    await time.run(10_000 - 2_100 - 1);
    expect((await rows(pinned.correlationId)).map((r) => r.status)).toEqual([
      "pending",
      "returned",
    ]);
    await time.run(1);
    await vi.waitFor(() => expect(t.deps.dispatcher.inFlight()).toBe(0));
    expect(await rows(pinned.correlationId)).toEqual([
      {
        sourceId: "nationalSource",
        status: "timedOut",
        timedOutAt: pinned.acknowledgedAt + 10_000,
        payload: null,
      },
      {
        sourceId: "stateSource",
        status: "returned",
        timedOutAt: null,
        payload: { status: "NO RECORD" },
      },
    ]);
    expect(t.fatals).toEqual([]);
  });
});
