import { createResetController } from "@querymodule/client";
import { describe, expect, it } from "vitest";
import { createConfigDraftStore, type JsonObject, registerConfigDraft } from "./draft.js";

// B1 undo/redo on the draft: memory only, coalesced typing, a 100-step cap, cleared on reset.

const seed = (): JsonObject => ({ a: 1, b: { c: "x" }, list: [1, 2] });
const started = () => {
  const store = createConfigDraftStore();
  store.getState().start(seed());
  return store;
};
const doc = (s: ReturnType<typeof started>) => s.getState().doc;

describe("draft history (undo and redo)", () => {
  it("undo restores the document before the edit and redo re-applies it", () => {
    const store = started();
    store.getState().setPath(["a"], 2);
    expect(store.getState().undoCount).toBe(1);
    expect(store.getState().redoCount).toBe(0);
    expect(store.getState().undo()).not.toBeNull();
    expect(doc(store)).toEqual(seed());
    expect(store.getState().undoCount).toBe(0);
    expect(store.getState().redoCount).toBe(1);
    store.getState().redo();
    expect((doc(store) as JsonObject).a).toBe(2);
    expect(store.getState().redoCount).toBe(0);
  });

  it("undo and redo with nothing to do change nothing and return null", () => {
    const store = started();
    const before = store.getState();
    expect(store.getState().undo()).toBeNull();
    expect(store.getState().redo()).toBeNull();
    expect(store.getState()).toBe(before);
  });

  it("an edit after an undo clears what could be redone", () => {
    const store = started();
    store.getState().setPath(["a"], 2);
    store.getState().undo();
    store.getState().setPath(["a"], 3);
    expect(store.getState().redoCount).toBe(0);
    expect(store.getState().redo()).toBeNull();
  });

  it("a setting to the value it already has is not a step", () => {
    const store = started();
    store.getState().setPath(["a"], 1);
    store.getState().setPath(["b", "c"], "x");
    store.getState().setLabel("en", "k", "T");
    store.getState().setLabel("en", "k", "T");
    expect(store.getState().undoCount).toBe(1);
  });

  it("typing in one control is one step; another control, or an undo in between, starts a new one", () => {
    const store = started();
    for (const v of ["h", "he", "hel", "hell", "hello"])
      store.getState().setPath(["b", "c"], v, { coalesce: true });
    expect(store.getState().undoCount).toBe(1);
    store.getState().setPath(["a"], 9, { coalesce: true });
    expect(store.getState().undoCount).toBe(2);
    store.getState().undo();
    store.getState().setPath(["a"], 10, { coalesce: true });
    store.getState().setPath(["a"], 11, { coalesce: true });
    expect(store.getState().undoCount).toBe(2);
    store.getState().undo();
    store.getState().undo();
    expect(doc(store)).toEqual(seed());
  });

  it("only text entry coalesces: separate structural edits, toggles and choices are separate steps", () => {
    const store = started();
    // Two removals from one list write the same path twice: two steps, two undos.
    store.getState().setPath(["list"], [1]);
    store.getState().setPath(["list"], []);
    expect(store.getState().undoCount).toBe(2);
    // A toggle on then off is two steps, not one that undoes to nothing visible.
    store.getState().setPath(["b", "flag"], true);
    store.getState().setPath(["b", "flag"], false);
    expect(store.getState().undoCount).toBe(4);
    store.getState().undo();
    expect((doc(store) as { b: { flag: boolean } }).b.flag).toBe(true);
  });

  it("choosing another item ends the typing step: editing the same control again is a new step", () => {
    const store = started();
    store.getState().setMeta("/a");
    store.getState().setPath(["a"], 2, { coalesce: true });
    store.getState().setPath(["a"], 3, { coalesce: true });
    expect(store.getState().undoCount).toBe(1);
    store.getState().setMeta("/b");
    store.getState().setPath(["a"], 4, { coalesce: true });
    expect(store.getState().undoCount).toBe(2);
    // The selection setting to what it already is changes nothing.
    store.getState().setMeta("/b");
    store.getState().setPath(["a"], 5, { coalesce: true });
    expect(store.getState().undoCount).toBe(2);
  });

  it("labels: one step per key while typing, removal is a step, and both undo", () => {
    const store = started();
    for (const v of ["C", "Ca", "Car"]) store.getState().setLabel("en", "queryType.VEH", v);
    store.getState().setLabel("en", "queryType.PER", "Person");
    expect(store.getState().undoCount).toBe(2);
    store.getState().removeLabel("en", "queryType.VEH");
    expect(store.getState().labels).toEqual({ en: { "queryType.PER": "Person" } });
    expect(store.getState().undoCount).toBe(3);
    store.getState().undo();
    expect(store.getState().labels).toEqual({
      en: { "queryType.VEH": "Car", "queryType.PER": "Person" },
    });
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().labels).toEqual({});
  });

  it("removing a label that is not there is not a step", () => {
    const store = started();
    store.getState().removeLabel("en", "nope");
    expect(store.getState().undoCount).toBe(0);
  });

  it("a whole-document replacement (a raw edit) is a step of its own and coalesces with itself", () => {
    const store = started();
    store.getState().setDoc({ a: 5 });
    store.getState().setDoc({ a: 6 });
    expect(store.getState().undoCount).toBe(1);
    store.getState().setPath(["a"], 7);
    expect(store.getState().undoCount).toBe(2);
    store.getState().undo();
    expect(doc(store)).toEqual({ a: 6 });
    store.getState().undo();
    expect(doc(store)).toEqual(seed());
  });

  it("a document and its labels are undone together, in the order they were made", () => {
    const store = started();
    store.getState().setPath(["a"], 2);
    store.getState().setLabel("en", "k", "T");
    store.getState().undo();
    expect((doc(store) as JsonObject).a).toBe(2);
    expect(store.getState().labels).toEqual({});
    store.getState().undo();
    expect((doc(store) as JsonObject).a).toBe(1);
  });

  it("keeps at most 100 steps: the oldest are dropped", () => {
    const store = started();
    for (let i = 1; i <= 150; i++) store.getState().setPath([i % 2 === 0 ? "a" : "z"], i);
    expect(store.getState().undoCount).toBe(100);
    for (let i = 0; i < 100; i++) store.getState().undo();
    expect(store.getState().undo()).toBeNull();
    // The state reached is the one after edit 50, not the seed.
    expect((doc(store) as JsonObject).a).toBe(50);
  });

  it("start() seeds without a step, and a second start keeps the edits", () => {
    const store = started();
    expect(store.getState().undoCount).toBe(0);
    store.getState().setPath(["a"], 2);
    store.getState().start({ other: true });
    expect((doc(store) as JsonObject).a).toBe(2);
    expect(store.getState().undoCount).toBe(1);
  });

  it("reset clears the document, the labels and the history; the ResetController does it on sign-out", () => {
    const reset = createResetController();
    const store = started();
    registerConfigDraft(reset, store);
    store.getState().setPath(["a"], 2);
    store.getState().undo();
    store.getState().setLabel("en", "k", "T");
    reset.resetAll();
    expect(store.getState().doc).toBeNull();
    expect(store.getState().undoCount).toBe(0);
    expect(store.getState().redoCount).toBe(0);
    expect(store.getState().undo()).toBeNull();
    expect(store.getState().redo()).toBeNull();
  });

  it("undo and redo hand back the selection the state had", () => {
    const store = started();
    store.getState().setMeta("/queryTypes/0");
    store.getState().setPath(["a"], 2);
    store.getState().setMeta("/commands");
    store.getState().setPath(["b", "c"], "y");
    // Undo returns to the state before the last edit, when Commands... was not yet selected.
    expect(store.getState().undo()).toEqual({ meta: "/commands" });
    expect(store.getState().undo()).toEqual({ meta: "/queryTypes/0" });
    // Redo returns to the selection each state had when it was left.
    expect(store.getState().redo()).toEqual({ meta: "/commands" });
    expect(store.getState().redo()).toEqual({ meta: "/commands" });
  });

  it("setting the selection is not a step and does not clear redo", () => {
    const store = started();
    store.getState().setPath(["a"], 2);
    store.getState().undo();
    store.getState().setMeta("/x");
    expect(store.getState().undoCount).toBe(0);
    expect(store.getState().redoCount).toBe(1);
  });
});
