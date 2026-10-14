import { describe, expect, it } from "vitest";
import { existingPointer } from "./builder-helpers.js";
import type { JsonObject } from "./draft.js";

// Task 10 fix round 1 (critic C2): a selection inside the cards that no longer exist moves to a
// type's cards row, never to the bare list, which the editor cannot show.
const doc = (cards: { id: string; queryType: string }[]): JsonObject =>
  ({
    queryTypes: [{ code: "VEH" }, { code: "PER" }],
    responseMappings: cards,
    elements: [],
  }) as unknown as JsonObject;

describe("existingPointer for result cards", () => {
  it("keeps a card that exists", () => {
    const d = doc([{ id: "a", queryType: "VEH" }]);
    expect(existingPointer(d, "/responseMappings/0")).toBe("/responseMappings/0");
  });

  it("sends a card past the end to the nearest card's type row", () => {
    const d = doc([
      { id: "a", queryType: "PER" },
      { id: "b", queryType: "VEH" },
    ]);
    expect(existingPointer(d, "/responseMappings/2")).toBe("#cards/VEH");
    expect(existingPointer(d, "/responseMappings/5/elements/1")).toBe("#cards/VEH");
  });

  it("sends the bare list, or an empty list, to the first query type's row", () => {
    expect(existingPointer(doc([{ id: "a", queryType: "PER" }]), "/responseMappings")).toBe(
      "#cards/PER",
    );
    expect(existingPointer(doc([]), "/responseMappings/0")).toBe("#cards/VEH");
  });
});
