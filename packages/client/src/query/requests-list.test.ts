import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestsStore, type QueryDetail, type RequestEntry } from "./requests.js";
import type { SubmitQueryResponse } from "./submit.js";

const idOf = (n: number): string => `01923abc-c3d4-7e5f-8a9b-${n.toString().padStart(12, "0")}`;
const T0 = 1_780_000_000_000;

/** One list entry (the list answers the detail shape with no payloads); mock data only. */
function entry(
  n: number,
  sources: { sourceId: string; status: string }[] = [
    { sourceId: "state", status: "pending" },
    { sourceId: "national", status: "pending" },
  ],
): QueryDetail {
  const submittedAt = T0 + n * 1000;
  return {
    correlationId: idOf(n),
    submittedAt,
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
          resultId: `res-${n}-${s.sourceId}`,
          adapterKind: "mock",
          errorCode: null,
          createdAt: submittedAt,
          receivedAt: s.status === "pending" ? null : submittedAt,
          timedOutAt: null,
          purged: false,
          ...s,
        })),
      },
    ],
  } as unknown as QueryDetail;
}

const ack = (n: number): SubmitQueryResponse => ({
  correlationId: idOf(n),
  acknowledgedAt: T0 + n * 1000,
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
});

const ids = (items: readonly RequestEntry[]) =>
  items.map((item) => (item.status === "acknowledged" ? item.correlationId : item.status));

const statuses = (row: RequestEntry | undefined) =>
  row?.status === "acknowledged" ? row.parts[0]?.sources.map((s) => s.status) : undefined;

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

describe("FR-065 applyList folds the request list into the store (spec 6.7, 6.8)", () => {
  it("an empty store gets one row per request, newest first, none duplicated", () => {
    const store = createRequestsStore();
    store.getState().applyList([entry(3), entry(2), entry(1)]);
    expect(ids(store.getState().items)).toEqual([idOf(3), idOf(2), idOf(1)]);
    store.getState().applyList([entry(3), entry(2), entry(1)]);
    expect(store.getState().items).toHaveLength(3);
  });

  it("rows come in as placeholders with the list's statuses and no payloads", () => {
    const store = createRequestsStore();
    store.getState().applyList([
      entry(1, [
        { sourceId: "state", status: "returned" },
        { sourceId: "national", status: "pending" },
      ]),
    ]);
    const row = store.getState().items[0];
    expect(row?.status === "acknowledged" && row.placeholder).toBe(true);
    expect(
      row?.status === "acknowledged" &&
        row.parts[0]?.sources.map((s) => [s.sourceId, s.status, s.result]),
    ).toEqual([
      ["state", "returned", undefined],
      ["national", "pending", undefined],
    ]);
  });

  it("entries already shown keep their row id and identity", () => {
    const store = createRequestsStore();
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    store.getState().settle(id, { kind: "acknowledged", response: ack(2), queryType: "VEH" });
    const before = store.getState().items[0];
    store.getState().applyList([entry(3), entry(2), entry(1)]);
    const items = store.getState().items;
    expect(items).toHaveLength(3);
    const kept = items.find((item) => item.id === id);
    expect(kept).toBe(before);
    expect(kept?.summary).toBe("VEH.ZZ-0001");
  });

  it("a request sent now stays on top; older list rows sit below it, newest first", () => {
    const store = createRequestsStore();
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    store.getState().applyList([entry(3), entry(2), entry(1)]);
    expect(store.getState().items.map((item) => item.id)[0]).toBe(id);
    expect(ids(store.getState().items.slice(1))).toEqual([idOf(3), idOf(2), idOf(1)]);
  });

  it("a row newer than those shown goes above them without moving them", () => {
    const store = createRequestsStore();
    store.getState().applyList([entry(2), entry(1)]);
    const [two, one] = store.getState().items;
    store.getState().applyList([entry(3), entry(2), entry(1)]);
    const items = store.getState().items;
    expect(ids(items)).toEqual([idOf(3), idOf(2), idOf(1)]);
    expect(items[1]).toBe(two);
    expect(items[2]).toBe(one);
  });

  it("a pending source the list shows settled moves forward and is announced", () => {
    const store = createRequestsStore();
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    store.getState().settle(id, { kind: "acknowledged", response: ack(1), queryType: "VEH" });
    const spoken: string[] = [];
    store.getState().onStatusSummary((a) => spoken.push(a.correlationId));
    store.getState().applyList([
      entry(1, [
        { sourceId: "state", status: "returned" },
        { sourceId: "national", status: "failed" },
      ]),
    ]);
    expect(statuses(store.getState().items[0])).toEqual(["returned", "failed"]);
    vi.advanceTimersByTime(1500);
    expect(spoken).toEqual([idOf(1)]);
  });

  it("a settled source never moves back to pending", () => {
    const store = createRequestsStore();
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    store.getState().settle(id, { kind: "acknowledged", response: ack(1), queryType: "VEH" });
    store.getState().applyEvent({
      v: 1,
      type: "sourceStatus",
      seq: 1,
      at: T0,
      correlationId: idOf(1),
      partId: 1,
      sourceId: "state",
      resultId: "01923abc-c3d4-7e5f-8a9b-0000000000aa",
      status: "failed",
    });
    store.getState().applyList([entry(1)]);
    expect(statuses(store.getState().items[0])).toEqual(["failed", "pending"]);
  });

  it("a placeholder from the list is replaced by the 202 of a request still in flight", () => {
    const store = createRequestsStore();
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    store.getState().applyList([entry(1)]);
    expect(store.getState().items).toHaveLength(2);
    store.getState().settle(id, { kind: "acknowledged", response: ack(1), queryType: "VEH" });
    const items = store.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toBe("VEH.ZZ-0001");
  });

  it("rows new from the list are not announced, even when their sources are settled", () => {
    const store = createRequestsStore();
    const spoken: string[] = [];
    store.getState().onStatusSummary((a) => spoken.push(a.correlationId));
    store.getState().applyList([
      entry(2, [
        { sourceId: "state", status: "returned" },
        { sourceId: "national", status: "returned" },
      ]),
    ]);
    vi.advanceTimersByTime(5000);
    expect(spoken).toEqual([]);
  });

  it("an empty list changes nothing and keeps the same items", () => {
    const store = createRequestsStore();
    store.getState().applyList([entry(1)]);
    const before = store.getState().items;
    store.getState().applyList([]);
    expect(store.getState().items).toBe(before);
  });

  it("a list that changes nothing keeps the same items", () => {
    const store = createRequestsStore();
    store.getState().applyList([entry(2), entry(1)]);
    const before = store.getState().items;
    store.getState().applyList([entry(2), entry(1)]);
    expect(store.getState().items).toBe(before);
  });

  it("the store stays within its 100 rows", () => {
    const store = createRequestsStore();
    store.getState().applyList(Array.from({ length: 70 }, (_, i) => entry(200 - i)));
    store.getState().applyList(Array.from({ length: 70 }, (_, i) => entry(100 - i)));
    expect(store.getState().items).toHaveLength(100);
  });
});
