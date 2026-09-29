import { describe, expect, it, vi } from "vitest";
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

describe("FR-056 inherited Object.prototype names are ordinary query types", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "%s selects, sets values and sources like any other type",
    (code) => {
      const store = createDraftStore();
      store.getState().select(code);
      expect(Object.hasOwn(store.getState().drafts, code)).toBe(true);
      expect(store.getState().drafts[code]).toEqual({ values: {}, sources: null });
      store.getState().setValue("plate", "ZZ-0001");
      store.getState().setSources(["a"]);
      store.getState().select("VEH");
      store.getState().select(code);
      expect(store.getState().drafts[code]).toEqual({
        values: { plate: "ZZ-0001" },
        sources: ["a"],
      });
    },
  );

  it("replaceValues on constructor starts from an empty draft, not Object", () => {
    const store = createDraftStore();
    store.getState().replaceValues("constructor", { plate: "ZZ-0002" });
    expect(store.getState().drafts.constructor).toEqual({
      values: { plate: "ZZ-0002" },
      sources: null,
    });
  });
});

describe("FR-056 the store copies what it is given", () => {
  it("setSources is not affected by a later mutation of the input", () => {
    const store = createDraftStore();
    store.getState().select("VEH");
    const input = ["a", "b"];
    store.getState().setSources(input);
    input.push("c");
    input[0] = "z";
    expect(store.getState().drafts.VEH?.sources).toEqual(["a", "b"]);
  });

  it("replaceValues is not affected by a later mutation of the input", () => {
    const store = createDraftStore();
    const input: Record<string, string> = { plate: "ZZ-0001" };
    store.getState().replaceValues("VEH", input);
    input.plate = "changed";
    input.extra = "leak";
    expect(store.getState().drafts.VEH?.values).toEqual({ plate: "ZZ-0001" });
  });
});

describe("SEC-006 the store never touches browser storage", () => {
  it("writes to no storage across every action", () => {
    const writes: string[] = [];
    const recorder = () => ({
      getItem: () => null,
      setItem: () => writes.push("setItem"),
      removeItem: () => writes.push("removeItem"),
    });
    vi.stubGlobal("localStorage", recorder());
    vi.stubGlobal("sessionStorage", recorder());
    try {
      const store = createDraftStore();
      store.getState().select("VEH");
      store.getState().setValue("plate", "ZZ-0001");
      store.getState().setSources(["a"]);
      store.getState().replaceValues("PER", { last: "Testcase" });
      store.getState().reset();
      expect(writes).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
