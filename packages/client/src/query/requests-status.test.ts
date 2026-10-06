import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceStatusEvent } from "../feed/feed-socket.js";
import { createRequestsStore, type RequestEntry, statusSummary } from "./requests.js";
import type { SubmitQueryResponse } from "./submit.js";

const CORRELATION = "01923abc-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const RESULT = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

const RESPONSE: SubmitQueryResponse = {
  correlationId: CORRELATION,
  acknowledgedAt: 1_780_000_000_000,
  parts: [
    {
      partId: 1,
      queryType: "VEH",
      status: "dispatched",
      sourceIds: ["state", "national"],
      droppedSourceIds: [],
    },
    { partId: 2, queryType: "WNT", status: "skipped", sourceIds: [], droppedSourceIds: [] },
  ],
};

function event(
  seq: number,
  sourceId: string,
  status: SourceStatusEvent["status"],
  extra: Partial<SourceStatusEvent> = {},
): SourceStatusEvent {
  return {
    v: 1,
    type: "sourceStatus",
    seq,
    at: 1_780_000_001_000,
    correlationId: CORRELATION,
    partId: 1,
    sourceId,
    resultId: RESULT,
    status,
    ...extra,
  } as SourceStatusEvent;
}

function setup() {
  const store = createRequestsStore();
  const summaries: { reference: string; text: string }[] = [];
  store.getState().onStatusSummary((s) => {
    summaries.push({
      reference: s.correlationId.slice(0, 8),
      text: `${s.queryType} ${s.summary.done} of ${s.summary.total} ${JSON.stringify(s.summary.byStatus)}`,
    });
  });
  const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
  store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "VEH" });
  const entry = (): Extract<RequestEntry, { status: "acknowledged" }> => {
    const found = store.getState().items[0];
    if (found?.status !== "acknowledged") throw new Error("not acknowledged");
    return found;
  };
  return { store, summaries, entry };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("FR-043 per-source status in the requests store (spec 6.6, 6.7)", () => {
  it("every dispatched pair starts pending and a skipped part stays skipped", () => {
    const { entry } = setup();
    expect(entry().parts[0]?.sources).toEqual([
      { sourceId: "state", status: "pending" },
      { sourceId: "national", status: "pending" },
    ]);
    expect(entry().parts[1]).toMatchObject({ status: "skipped", sources: [] });
    expect(statusSummary(entry())).toEqual({ done: 0, total: 2, byStatus: { pending: 2 } });
  });

  it("an event moves one source in place and the other rows are untouched", () => {
    const { store, entry } = setup();
    const before = store.getState().items;
    store.getState().applyEvent(event(1, "state", "returned"));
    expect(entry().parts[0]?.sources).toEqual([
      { sourceId: "state", status: "returned" },
      { sourceId: "national", status: "pending" },
    ]);
    expect(store.getState().items[0]?.id).toBe(before[0]?.id);
  });

  it("status never moves backwards and a terminal status is written once", () => {
    const { store, entry } = setup();
    store.getState().applyEvent(event(1, "state", "returned"));
    store.getState().applyEvent(event(2, "state", "pending"));
    store.getState().applyEvent(event(3, "state", "failed"));
    expect(entry().parts[0]?.sources[0]?.status).toBe("returned");
  });

  it("an event for an unknown part or source changes nothing", () => {
    const { store, entry } = setup();
    store.getState().applyEvent(event(1, "elsewhere", "returned"));
    store.getState().applyEvent(event(2, "state", "returned", { partId: 9 }));
    expect(statusSummary(entry()).done).toBe(0);
  });

  it("an event before the acknowledgment holds and the 202 fills it, without duplication", () => {
    const store = createRequestsStore();
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001" });
    store.getState().applyEvent(event(1, "state", "returned"));
    store.getState().applyEvent(event(1, "state", "returned"));
    expect(store.getState().items).toHaveLength(1);
    expect(store.getState().items[0]?.status).toBe("sending");
    store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "VEH" });
    const row = store.getState().items[0];
    if (row?.status !== "acknowledged") throw new Error("not acknowledged");
    expect(row.parts[0]?.sources).toEqual([
      { sourceId: "state", status: "returned" },
      { sourceId: "national", status: "pending" },
    ]);
  });

  it("holds placeholders for a bounded number of requests", () => {
    const store = createRequestsStore();
    for (let i = 0; i < 200; i += 1) {
      store.getState().applyEvent(
        event(i, "state", "returned", {
          correlationId: `0198a1b2-0000-7e5f-8a9b-${String(i).padStart(12, "0")}`,
        }),
      );
    }
    const id = store.getState().begin({ queryType: "VEH", summary: "x" });
    store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "VEH" });
    const row = store.getState().items[0];
    if (row?.status !== "acknowledged") throw new Error("not acknowledged");
    expect(row.parts[0]?.sources[0]?.status).toBe("pending");
  });

  it("reset clears the rows, held events and pending announcements", () => {
    const { store, summaries } = setup();
    store.getState().applyEvent(event(1, "state", "returned"));
    store
      .getState()
      .applyEvent(
        event(1, "state", "returned", { correlationId: "0198a1b2-1111-7e5f-8a9b-0c1d2e3f4a5b" }),
      );
    store.getState().reset();
    vi.advanceTimersByTime(5000);
    expect(store.getState().items).toEqual([]);
    expect(summaries).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("FR-044 coalesced announcements (spec 6.6)", () => {
  it("two events within 1500 ms give one summary", () => {
    const { store, summaries } = setup();
    store.getState().applyEvent(event(1, "state", "returned"));
    vi.advanceTimersByTime(400);
    store.getState().applyEvent(event(2, "national", "returned"));
    expect(summaries).toEqual([]);
    vi.advanceTimersByTime(1500);
    expect(summaries).toEqual([{ reference: "01923abc", text: 'VEH 2 of 2 {"returned":2}' }]);
  });

  it("events 2 s apart give two summaries", () => {
    const { store, summaries } = setup();
    store.getState().applyEvent(event(1, "state", "returned"));
    vi.advanceTimersByTime(2000);
    store.getState().applyEvent(event(2, "national", "timedOut"));
    vi.advanceTimersByTime(2000);
    expect(summaries.map((s) => s.text)).toEqual([
      'VEH 1 of 2 {"returned":1,"pending":1}',
      'VEH 2 of 2 {"returned":1,"timedOut":1}',
    ]);
  });

  it("a repeated or backwards event announces nothing", () => {
    const { store, summaries } = setup();
    store.getState().applyEvent(event(1, "state", "returned"));
    vi.advanceTimersByTime(2000);
    store.getState().applyEvent(event(2, "state", "returned"));
    store.getState().applyEvent(event(3, "state", "failed"));
    vi.advanceTimersByTime(2000);
    expect(summaries).toHaveLength(1);
  });

  it("an event held before the acknowledgment is announced once the 202 fills it", () => {
    const store = createRequestsStore();
    const texts: number[] = [];
    store.getState().onStatusSummary((s) => texts.push(s.summary.done));
    const id = store.getState().begin({ queryType: "VEH", summary: "x" });
    store.getState().applyEvent(event(1, "state", "returned"));
    vi.advanceTimersByTime(3000);
    expect(texts).toEqual([]);
    store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "VEH" });
    vi.advanceTimersByTime(1500);
    expect(texts).toEqual([1]);
  });

  it("unsubscribe stops delivery", () => {
    const store = createRequestsStore();
    const seen = vi.fn();
    const off = store.getState().onStatusSummary(seen);
    off();
    const id = store.getState().begin({ queryType: "VEH", summary: "x" });
    store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "VEH" });
    store.getState().applyEvent(event(1, "state", "returned"));
    vi.advanceTimersByTime(3000);
    expect(seen).not.toHaveBeenCalled();
  });

  it("the summary carries counts and ids only, never values", () => {
    const store = createRequestsStore();
    const seen = vi.fn();
    store.getState().onStatusSummary(seen);
    const id = store.getState().begin({
      queryType: "VEH",
      summary: "VEH.ZZ-0001",
      submitted: {
        queryType: "VEH",
        values: { plate: "ZZ-0001" },
        sourceIds: ["state"],
        mode: "normal",
      },
    });
    store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "VEH" });
    store.getState().applyEvent(event(1, "state", "returned"));
    vi.advanceTimersByTime(1500);
    expect(JSON.stringify(seen.mock.calls)).not.toContain("ZZ-0001");
  });
});
