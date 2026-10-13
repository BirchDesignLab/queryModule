import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestsStore, type QueryDetail } from "./requests.js";
import type { SubmitQueryResponse } from "./submit.js";

const CORRELATION = "01923abc-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const RESPONSE: SubmitQueryResponse = {
  correlationId: CORRELATION,
  acknowledgedAt: 1_780_000_000_000,
  parts: [
    {
      partId: 1,
      parentPartId: null,
      origin: "primary",
      queryType: "VEH",
      status: "dispatched",
      sourceIds: ["state", "national"],
      droppedSourceIds: [],
      skipReasons: [],
    },
  ],
};

function detail(
  sources: { sourceId: string; status: string; payload?: Record<string, unknown> }[],
): QueryDetail {
  return {
    correlationId: CORRELATION,
    submittedAt: 1_780_000_000_000,
    configHash: "h1",
    parts: [
      {
        partId: 1,
        parentPartId: null,
        origin: "primary",
        queryType: "VEH",
        typeValues: {},
        plateOnly: false,
        skipReasons: [],
        droppedSourceIds: [],
        purged: false,
        sources: sources.map((s) => ({
          resultId: `res-${s.sourceId}`,
          adapterKind: "mock",
          errorCode: null,
          createdAt: 1_780_000_000_000,
          receivedAt: s.status === "pending" ? null : 1_780_000_000_000,
          timedOutAt: null,
          purged: false,
          ...s,
        })),
      },
    ],
  } as unknown as QueryDetail;
}

function setup() {
  const store = createRequestsStore();
  const id = store.getState().begin({ queryType: "VEH", summary: "VEH.X" });
  store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "VEH" });
  const seen: { correlationId: string; partId: number; sourceId: string }[] = [];
  store.getState().onResult((r) => seen.push(r));
  return { store, seen };
}

describe("FR-060 spec 6.6 the store says when a payload arrives (ids only)", () => {
  it("fires once per source that gains a payload, with ids and never the payload", () => {
    const { store, seen } = setup();
    store.getState().applyDetail(
      detail([
        { sourceId: "state", status: "returned", payload: { status: "STOLEN" } },
        { sourceId: "national", status: "pending" },
      ]),
    );
    expect(seen).toEqual([{ correlationId: CORRELATION, partId: 1, sourceId: "state" }]);
    expect(JSON.stringify(seen)).not.toContain("STOLEN");
    // The same detail again changes nothing, so nothing fires again.
    store.getState().applyDetail(
      detail([
        { sourceId: "state", status: "returned", payload: { status: "STOLEN" } },
        { sourceId: "national", status: "pending" },
      ]),
    );
    expect(seen).toHaveLength(1);
    store.getState().applyDetail(
      detail([
        { sourceId: "state", status: "returned", payload: { status: "STOLEN" } },
        { sourceId: "national", status: "returned", payload: { status: "NO RECORD" } },
      ]),
    );
    expect(seen.map((s) => s.sourceId)).toEqual(["state", "national"]);
  });

  it("a placeholder row built from a detail reports the payloads it holds", () => {
    const store = createRequestsStore();
    const seen: string[] = [];
    store.getState().onResult((r) => seen.push(r.sourceId));
    store
      .getState()
      .applyDetail(detail([{ sourceId: "state", status: "returned", payload: { a: "b" } }]));
    expect(seen).toEqual(["state"]);
  });

  it("returns an unsubscribe", () => {
    const { store, seen } = setup();
    const off = store.getState().onResult((r) => seen.push(r));
    off();
    store
      .getState()
      .applyDetail(detail([{ sourceId: "state", status: "returned", payload: { a: "b" } }]));
    // Only the handler setup() registered is left.
    expect(seen).toHaveLength(1);
  });
});

describe("spec 6.6 a payload that lands after the summary window earns its own summary", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a payload fetched after the status, past 1500 ms, yields a second summary", () => {
    const { store } = setup();
    const summaries: number[] = [];
    store.getState().onStatusSummary((s) => summaries.push(s.summary.done));
    store.getState().applyDetail(
      detail([
        { sourceId: "state", status: "returned", payload: { status: "STOLEN" } },
        { sourceId: "national", status: "returned" },
      ]),
    );
    vi.advanceTimersByTime(1500);
    expect(summaries).toEqual([2]);
    store.getState().applyDetail(
      detail([
        { sourceId: "state", status: "returned", payload: { status: "STOLEN" } },
        { sourceId: "national", status: "returned", payload: { status: "EXPIRED" } },
      ]),
    );
    vi.advanceTimersByTime(1500);
    expect(summaries).toEqual([2, 2]);
  });
});
