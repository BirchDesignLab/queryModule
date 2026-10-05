import { describe, expect, it } from "vitest";
import { createConfigDraftStore, type JsonObject } from "./draft.js";

// Task 2 (#548, CFG-2): the mock document is a slice of the draft with undo like the other slices.
// Memory only (spec 6.7); the ResetController clears it with the draft.

const MOCK_A: JsonObject = {
  siteId: "default",
  sources: { a: { latencyMs: [1, 2], responses: [] } },
};
const MOCK_B: JsonObject = {
  siteId: "default",
  sources: { a: { latencyMs: [3, 4], responses: [] } },
};

const server = (mock?: JsonObject) => ({
  document: { siteConfig: {}, locales: {}, ...(mock === undefined ? {} : { mock }) },
  siteId: "default",
  baseVersion: 3,
  draftVersion: null,
  liveDoc: { a: 1 },
  liveLabels: {},
  savedDoc: { a: 1 },
  savedLabels: {},
  ...(mock === undefined ? {} : { savedMock: mock, liveMock: mock }),
});

const started = (mock?: JsonObject) => {
  const store = createConfigDraftStore();
  store.getState().start({ a: 1 }, { server: server(mock) });
  return store;
};

describe("the draft's mock slice", () => {
  it("starts from the server document's mock, or null when the site has none", () => {
    expect(started(MOCK_A).getState().mock).toEqual(MOCK_A);
    expect(started().getState().mock).toBeNull();
  });

  it("setMock is one undo step and undo and redo restore it", () => {
    const store = started(MOCK_A);
    store.getState().setMock(MOCK_B);
    expect(store.getState().mock).toEqual(MOCK_B);
    expect(store.getState().undoCount).toBe(1);
    store.getState().undo();
    expect(store.getState().mock).toEqual(MOCK_A);
    store.getState().redo();
    expect(store.getState().mock).toEqual(MOCK_B);
  });

  it("an undo of a form edit leaves the mock alone, and the reverse", () => {
    const store = started(MOCK_A);
    store.getState().setPath(["a"], 2);
    store.getState().setMock(MOCK_B);
    store.getState().undo();
    expect(store.getState().mock).toEqual(MOCK_A);
    expect((store.getState().doc as JsonObject).a).toBe(2);
  });

  it("setMock with the same mock is not a step", () => {
    const store = started(MOCK_A);
    store.getState().setMock(MOCK_A);
    expect(store.getState().undoCount).toBe(0);
  });

  it("load replaces the mock from the new server base and clears undo", () => {
    const store = started(MOCK_A);
    store.getState().setMock(MOCK_B);
    store.getState().load({ a: 9 }, {}, server(MOCK_B));
    expect(store.getState().mock).toEqual(MOCK_B);
    expect(store.getState().undoCount).toBe(0);
  });

  it("markSaved records the mock that was sent; setLive replaces the live mock only", () => {
    const store = started(MOCK_A);
    store.getState().setMock(MOCK_B);
    store.getState().markSaved(
      4,
      { siteConfig: {}, locales: {}, mock: MOCK_B },
      {
        doc: { a: 1 },
        labels: {},
        mock: MOCK_B,
      },
    );
    expect(store.getState().server?.savedMock).toEqual(MOCK_B);
    store.getState().setLive({ a: 1 }, {}, MOCK_B);
    expect(store.getState().server?.liveMock).toEqual(MOCK_B);
    expect(store.getState().mock).toEqual(MOCK_B);
    expect(store.getState().undoCount).toBe(1);
  });

  it("consecutive edits of one control are one undo step; another control starts a new one", () => {
    const store = started(MOCK_A);
    store.getState().setMock({ ...MOCK_A, siteId: "a" }, { coalesce: "value:1" });
    store.getState().setMock({ ...MOCK_A, siteId: "ab" }, { coalesce: "value:1" });
    store.getState().setMock({ ...MOCK_A, siteId: "abc" }, { coalesce: "value:1" });
    expect(store.getState().undoCount).toBe(1);
    store.getState().setMock({ ...MOCK_A, siteId: "abcd" }, { coalesce: "value:2" });
    expect(store.getState().undoCount).toBe(2);
    store.getState().setMock({ ...MOCK_A, siteId: "x" });
    store.getState().setMock({ ...MOCK_A, siteId: "y" });
    expect(store.getState().undoCount).toBe(4);
    store.getState().undo();
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().mock).toEqual({ ...MOCK_A, siteId: "abc" });
  });

  it("setMock before the draft is started does nothing; reset clears the mock", () => {
    const store = createConfigDraftStore();
    store.getState().setMock(MOCK_B);
    expect(store.getState().mock).toBeNull();
    const started2 = started(MOCK_A);
    started2.getState().reset();
    expect(started2.getState().mock).toBeNull();
  });
});
