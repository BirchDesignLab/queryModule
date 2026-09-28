import { describe, expect, it } from "vitest";
import { createDraftStore } from "./draft-store.js";

describe("FR-056 draft store keeps user values per query type (spec 4.4, 6.7)", () => {
  it("starts empty with no selected type", () => {
    const state = createDraftStore().getState();
    expect(state.queryType).toBeNull();
    expect(state.drafts).toEqual({});
  });

  it("keeps a type's values when another type is selected and back", () => {
    const store = createDraftStore();
    store.getState().select("VEH");
    store.getState().setValue("plate", "ZZ-0001");
    store.getState().select("PER");
    store.getState().setValue("last", "Testcase");
    store.getState().select("VEH");
    const { drafts, queryType } = store.getState();
    expect(queryType).toBe("VEH");
    expect(drafts.VEH?.values.plate).toBe("ZZ-0001");
    expect(drafts.PER?.values.last).toBe("Testcase");
  });

  it("stores boolean and null values as entered", () => {
    const store = createDraftStore();
    store.getState().select("VEH");
    store.getState().setValue("flag", true);
    store.getState().setValue("plate", null);
    expect(store.getState().drafts.VEH?.values).toEqual({ flag: true, plate: null });
  });

  it("setValue without a selected type does nothing", () => {
    const store = createDraftStore();
    store.getState().setValue("plate", "x");
    expect(store.getState().drafts).toEqual({});
  });

  it("setSources stores per type and defaults to null", () => {
    const store = createDraftStore();
    store.getState().select("VEH");
    expect(store.getState().drafts.VEH?.sources).toBeNull();
    store.getState().setSources(["a", "b"]);
    store.getState().select("PER");
    store.getState().setSources(["c"]);
    expect(store.getState().drafts.VEH?.sources).toEqual(["a", "b"]);
    expect(store.getState().drafts.PER?.sources).toEqual(["c"]);
  });

  it("setSources without a selected type does nothing", () => {
    const store = createDraftStore();
    store.getState().setSources(["a"]);
    expect(store.getState().drafts).toEqual({});
  });

  it("replaceValues replaces one type's values only and keeps its sources", () => {
    const store = createDraftStore();
    store.getState().select("VEH");
    store.getState().setValue("plate", "ZZ-0001");
    store.getState().setSources(["a"]);
    store.getState().select("PER");
    store.getState().setValue("last", "Testcase");
    store.getState().replaceValues("VEH", { vin: "V1" });
    const { drafts } = store.getState();
    expect(drafts.VEH?.values).toEqual({ vin: "V1" });
    expect(drafts.VEH?.sources).toEqual(["a"]);
    expect(drafts.PER?.values).toEqual({ last: "Testcase" });
  });

  it("replaceValues creates a draft for an unseen type", () => {
    const store = createDraftStore();
    store.getState().replaceValues("VEH", { plate: "ZZ-0002" });
    expect(store.getState().drafts.VEH).toEqual({ values: { plate: "ZZ-0002" }, sources: null });
  });

  it("reset empties everything", () => {
    const store = createDraftStore();
    store.getState().select("VEH");
    store.getState().setValue("plate", "ZZ-0001");
    store.getState().reset();
    expect(store.getState().queryType).toBeNull();
    expect(store.getState().drafts).toEqual({});
  });

  it("SEC-006: state has no persist key", () => {
    expect(Object.keys(createDraftStore())).not.toContain("persist");
    expect(Object.keys(createDraftStore().getState())).not.toContain("persist");
  });
});
