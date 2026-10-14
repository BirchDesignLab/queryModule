import { describe, expect, it } from "vitest";
import { RAW_SITE } from "../test/msw-server.js";
import { editorOf } from "./admin-config.js";
import { applyCardsEdit, cardsSiteOf } from "./builder-store.js";
import { addCard, addKeyword, moveCard, removeCard, updateCard } from "./cards-model.js";
import { type ConfigDraftStore, createConfigDraftStore, type JsonObject } from "./draft.js";

// Task 9 (#602, FR-060): card and keyword edits go through the draft's own undo, one step per edit.

const loaded = (): ConfigDraftStore => {
  const store = createConfigDraftStore();
  store.getState().start(editorOf({ siteConfig: RAW_SITE, locales: {} }).doc);
  return store;
};
const doc = (s: ConfigDraftStore) => s.getState().doc as JsonObject;
const ids = (s: ConfigDraftStore) => cardsSiteOf(doc(s)).responseMappings.map((m) => m.id);

describe("applyCardsEdit", () => {
  it("writes an added card to the draft and undo takes it back", () => {
    const store = loaded();
    const before = doc(store);
    const count = ids(store).length;
    let index = -1;
    expect(
      applyCardsEdit(store, (site) => {
        const r = addCard(site, "VEH");
        index = r.index;
        return r.site;
      }),
    ).toBe(true);
    expect(index).toBe(count);
    expect(ids(store)).toHaveLength(count + 1);
    expect(store.getState().undoCount).toBe(1);
    store.getState().undo();
    expect(doc(store)).toBe(before);
    expect(ids(store)).toHaveLength(count);
    store.getState().redo();
    expect(ids(store)).toHaveLength(count + 1);
  });

  it("each card edit is its own undo step, in order", () => {
    const store = loaded();
    const first = ids(store);
    applyCardsEdit(store, (s) => moveCard(s, 0, 2));
    applyCardsEdit(store, (s) => removeCard(s, 0));
    applyCardsEdit(store, (s) => addKeyword(s, "TESTMAKE", "warning").site);
    expect(store.getState().undoCount).toBe(3);
    store.getState().undo();
    expect(cardsSiteOf(doc(store)).keywords.map((k) => k.keyword)).not.toContain("TESTMAKE");
    store.getState().undo();
    expect(ids(store)).toHaveLength(first.length);
    store.getState().undo();
    expect(ids(store)).toEqual(first);
    expect(store.getState().undoCount).toBe(0);
  });

  it("a no-op edit records no step and changes nothing", () => {
    const store = loaded();
    const before = doc(store);
    expect(applyCardsEdit(store, (s) => s)).toBe(false);
    expect(applyCardsEdit(store, (s) => removeCard(s, 99))).toBe(false);
    expect(applyCardsEdit(store, (s) => updateCard(s, 0, s.responseMappings[0] as never))).toBe(
      false,
    );
    expect(doc(store)).toBe(before);
    expect(store.getState().undoCount).toBe(0);
  });

  it("coalesce makes consecutive edits of one control one step", () => {
    const store = loaded();
    const { index } = (() => {
      let i = -1;
      applyCardsEdit(store, (s) => {
        const r = addKeyword(s, "A", "info");
        i = r.index;
        return r.site;
      });
      return { index: i };
    })();
    const typed = (text: string) =>
      applyCardsEdit(
        store,
        (s) => ({
          ...s,
          keywords: s.keywords.map((k, n) => (n === index ? { ...k, keyword: text } : k)),
        }),
        { coalesce: true },
      );
    typed("AB");
    typed("ABC");
    typed("ABCD");
    expect(store.getState().undoCount).toBe(2);
    store.getState().undo();
    expect(cardsSiteOf(doc(store)).keywords[index]?.keyword).toBe("A");
  });

  it("does nothing before the draft is loaded", () => {
    const store = createConfigDraftStore();
    expect(applyCardsEdit(store, (s) => addCard(s, "VEH").site)).toBe(false);
    expect(store.getState().doc).toBeNull();
  });

  it("the edit sees the draft's query types, so a type's cards can be listed", () => {
    const store = loaded();
    let codes: string[] = [];
    applyCardsEdit(store, (s) => {
      codes = s.queryTypes.map((q) => q.code);
      return s;
    });
    expect(codes).toEqual(["VEH", "PER", "PRO", "WNT", "DL"]);
  });
});

describe("cardsSiteOf", () => {
  it("is empty before the draft loads or when a section is missing", () => {
    expect(cardsSiteOf(null)).toEqual({ responseMappings: [], keywords: [], queryTypes: [] });
    expect(cardsSiteOf({ keywords: "nope" })).toEqual({
      responseMappings: [],
      keywords: [],
      queryTypes: [],
    });
  });
});
