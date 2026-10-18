import { describe, expect, it } from "vitest";
import { createRequestsStore, type QueryDetail } from "./requests.js";
import type { SubmitQueryResponse } from "./submit.js";

// BW3 Task 6 (#735; FR-062 read half, SEC-021; spec 5.5, 6.2): retention purges the payload first,
// then the values. The store keeps what the detail says (a purged flag on the source and on the
// part, the type values that survive) and never invents a payload. Memory only, like the payloads.

const CORRELATION = "01923abc-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const RESPONSE: SubmitQueryResponse = {
  correlationId: CORRELATION,
  acknowledgedAt: 1_780_000_000_000,
  parts: [
    {
      partId: 1,
      parentPartId: null,
      origin: "primary",
      queryType: "PRO",
      status: "dispatched",
      sourceIds: ["national"],
      droppedSourceIds: [],
      skipReasons: [],
    },
  ],
};

function purgedDetail(over: { values?: boolean } = {}): QueryDetail {
  return {
    correlationId: CORRELATION,
    submittedAt: 1_780_000_000_000,
    configHash: "h1",
    parts: [
      {
        partId: 1,
        parentPartId: null,
        origin: "primary",
        queryType: "PRO",
        typeValues: { propertyType: "ARTICLE" },
        plateOnly: false,
        skipReasons: [],
        droppedSourceIds: [],
        purged: !over.values,
        ...(over.values ? { values: { propertyType: "ARTICLE" } } : {}),
        sources: [
          {
            resultId: "res-national",
            sourceId: "national",
            status: "returned",
            adapterKind: "mock",
            errorCode: null,
            createdAt: 1_780_000_000_000,
            receivedAt: 1_780_000_000_000,
            timedOutAt: null,
            purged: true,
          },
        ],
      },
    ],
  } as unknown as QueryDetail;
}

function acknowledged() {
  const store = createRequestsStore();
  const id = store.getState().begin({ queryType: "PRO", summary: "" });
  store.getState().settle(id, { kind: "acknowledged", response: RESPONSE, queryType: "PRO" });
  return store;
}
const firstEntry = (store: ReturnType<typeof createRequestsStore>) => {
  const entry = store.getState().items[0];
  if (entry?.status !== "acknowledged") throw new Error("not acknowledged");
  return entry;
};

describe("purged results and values in the requests store", () => {
  it("marks a returned source whose payload was purged, with no result and no arrival", () => {
    const store = acknowledged();
    const seen: unknown[] = [];
    store.getState().onResult((r) => seen.push(r));
    store.getState().applyDetail(purgedDetail());
    const source = firstEntry(store).parts[0]?.sources[0];
    expect(source).toMatchObject({ sourceId: "national", status: "returned", purged: true });
    expect(source?.result).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("marks a part whose values were purged and keeps its type values", () => {
    const store = acknowledged();
    store.getState().applyDetail(purgedDetail());
    const part = firstEntry(store).parts[0];
    expect(part).toMatchObject({ purged: true, typeValues: { propertyType: "ARTICLE" } });
    expect(part?.values).toBeUndefined();
  });

  it("a part that kept its values is not marked purged, whatever its results", () => {
    const store = acknowledged();
    store.getState().applyDetail(purgedDetail({ values: true }));
    const part = firstEntry(store).parts[0];
    expect(part?.purged).toBeUndefined();
    expect(part?.values).toEqual({ propertyType: "ARTICLE" });
    expect(part?.sources[0]?.purged).toBe(true);
  });

  it("a request this list never sent (a placeholder from the detail) carries the same marks", () => {
    const store = createRequestsStore();
    store.getState().applyDetail(purgedDetail());
    const part = firstEntry(store).parts[0];
    expect(part).toMatchObject({ purged: true, typeValues: { propertyType: "ARTICLE" } });
    expect(part?.sources[0]).toMatchObject({ status: "returned", purged: true });
  });
});
