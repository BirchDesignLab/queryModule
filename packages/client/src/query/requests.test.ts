import { describe, expect, it } from "vitest";
import { createRequestsStore } from "./requests.js";
import type { SubmitQueryResponse } from "./submit.js";

const RESPONSE: SubmitQueryResponse = {
  correlationId: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  acknowledgedAt: 1_780_000_000_000,
  parts: [
    {
      partId: 1,
      queryType: "VEH",
      status: "dispatched",
      sourceIds: ["state"],
      droppedSourceIds: [],
    },
  ],
};

describe("spec 6.7 requests this session (memory only)", () => {
  it("begin adds a Sending row, newest first, with a local key", () => {
    const store = createRequestsStore();
    const first = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001.TX" });
    const second = store.getState().begin({ queryType: "PER", summary: "PER.TESTERSON" });
    const items = store.getState().items;
    expect(items.map((i) => i.id)).toEqual([second, first]);
    expect(items[1]).toMatchObject({
      queryType: "VEH",
      summary: "VEH.ZZ-0001.TX",
      status: "sending",
    });
    expect(first).not.toBe(second);
  });

  it("an acknowledged outcome keeps the reference, time and parts", () => {
    const store = createRequestsStore();
    const id = store.getState().begin({ queryType: "VEH", summary: "VEH.ZZ-0001.TX" });
    store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "VEH" });
    expect(store.getState().items[0]).toMatchObject({
      id,
      status: "acknowledged",
      correlationId: RESPONSE.correlationId,
      acknowledgedAt: RESPONSE.acknowledgedAt,
      parts: RESPONSE.parts,
    });
  });

  it.each([
    "invalid",
    "configChanged",
    "rateLimited",
    "forbidden",
    "unavailable",
    "noResponse",
    "failed",
  ] as const)("a %s outcome is Failed with that reason key", (kind) => {
    const store = createRequestsStore();
    const id = store.getState().begin({ queryType: "VEH", summary: "x" });
    const outcome =
      kind === "invalid"
        ? { kind, errors: [] }
        : kind === "rateLimited"
          ? { kind, retryAfterSeconds: 3 }
          : { kind };
    store.getState().settle(id, outcome);
    expect(store.getState().items[0]).toMatchObject({ status: "failed", failure: kind });
  });

  it("settling only touches its own row and never reorders", () => {
    const store = createRequestsStore();
    const a = store.getState().begin({ queryType: "VEH", summary: "a" });
    const b = store.getState().begin({ queryType: "PER", summary: "b" });
    store.getState().settle(a, { kind: "failed" });
    expect(store.getState().items.map((i) => [i.id, i.status])).toEqual([
      [b, "sending"],
      [a, "failed"],
    ]);
  });

  it("reset empties the list, and a late outcome for a cleared row is ignored", () => {
    const store = createRequestsStore();
    const id = store.getState().begin({ queryType: "VEH", summary: "a" });
    store.getState().reset();
    expect(store.getState().items).toEqual([]);
    store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "VEH" });
    expect(store.getState().items).toEqual([]);
    // Keys are never reused, so a stale outcome cannot land on a row begun after the reset.
    const next = store.getState().begin({ queryType: "VEH", summary: "b" });
    expect(next).not.toBe(id);
    store.getState().settle(id, { kind: "failed" });
    expect(store.getState().items[0]?.status).toBe("sending");
  });

  it("keeps at most 100 rows, dropping the oldest", () => {
    const store = createRequestsStore();
    for (let i = 0; i < 105; i += 1) store.getState().begin({ queryType: "VEH", summary: `r${i}` });
    const items = store.getState().items;
    expect(items).toHaveLength(100);
    expect(items[0]?.summary).toBe("r104");
    expect(items[99]?.summary).toBe("r5");
  });
});
