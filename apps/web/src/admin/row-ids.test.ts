import { describe, expect, it } from "vitest";
import { alignRowIds } from "./row-ids.js";

// BW3 polish (#642, CRITIC-M2): rows without an identity get a stable one, so row-local state
// follows the row through removal, undo, redo and edits.

function make() {
  const known = new WeakMap<object, number>();
  let next = 0;
  const mint = () => next++;
  let ids: number[] = [];
  return {
    align(items: readonly object[]) {
      ids = alignRowIds(items, ids, known, mint);
      return ids;
    },
  };
}

describe("alignRowIds", () => {
  it("gives a first list distinct ids", () => {
    const rows = make();
    expect(rows.align([{}, {}, {}])).toEqual([0, 1, 2]);
  });

  it("keeps each row's id when an earlier row is removed, and when the removal is undone", () => {
    const rows = make();
    const [a, b, c] = [{ n: "a" }, { n: "b" }, { n: "c" }];
    expect(rows.align([a, b, c])).toEqual([0, 1, 2]);
    expect(rows.align([a, c])).toEqual([0, 2]);
    // The undo hands back the objects it held: b is row 1 again, with its old id.
    expect(rows.align([a, b, c])).toEqual([0, 1, 2]);
  });

  it("follows a reorder, and its undo", () => {
    const rows = make();
    const [a, b] = [{}, {}];
    rows.align([a, b]);
    expect(rows.align([b, a])).toEqual([1, 0]);
    expect(rows.align([a, b])).toEqual([0, 1]);
  });

  it("treats a new object at an unchanged length as an edit of the row there", () => {
    const rows = make();
    const [a, b] = [{ n: 1 }, { n: 2 }];
    rows.align([a, b]);
    expect(rows.align([a, { n: 3 }])).toEqual([0, 1]);
    expect(rows.align([a, { n: 4 }])).toEqual([0, 1]);
  });

  it("gives an added row a new id and never reuses one", () => {
    const rows = make();
    const [a, b] = [{}, {}];
    rows.align([a, b]);
    expect(rows.align([a, b, {}])).toEqual([0, 1, 2]);
    expect(rows.align([a])).toEqual([0]);
    expect(rows.align([a, {}])).toEqual([0, 3]);
  });
});
