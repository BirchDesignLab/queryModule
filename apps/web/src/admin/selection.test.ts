import { describe, expect, it } from "vitest";
import { cardsTypePointer, editorItem, keywordsPreviewPointer } from "./selection.js";

// Task 11 (#604): the keyword styles are edited with the keywords, and the preview beside the
// keywords shows a card of the first type.

describe("editorItem", () => {
  it("sends a pointer into the keyword styles to the keywords item", () => {
    expect(editorItem("/keywordSeverityStyles")).toBe("/keywords");
    expect(editorItem("/keywordSeverityStyles/critical")).toBe("/keywords");
    expect(editorItem("/keywordSeverityStyles/critical/color")).toBe("/keywords");
  });

  it("leaves every other pointer as it is", () => {
    for (const p of ["/keywords", "/keywords/2/except/0", "/keywordSeverityStylesX", "/theme"])
      expect(editorItem(p)).toBe(p);
  });
});

describe("keywordsPreviewPointer", () => {
  const types = [{ code: "PER" }, { code: "VEH" }];

  it("is the type of the first card", () => {
    expect(
      keywordsPreviewPointer({ queryTypes: types, responseMappings: [{ queryType: "VEH" }] }),
    ).toBe(cardsTypePointer("VEH"));
  });

  it("is the first query type when there are no cards", () => {
    expect(keywordsPreviewPointer({ queryTypes: types, responseMappings: [] })).toBe(
      cardsTypePointer("PER"),
    );
  });

  it("is null for a draft with neither", () => {
    expect(keywordsPreviewPointer({})).toBeNull();
  });
});
