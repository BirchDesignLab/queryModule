import { describe, expect, it } from "vitest";
import { type FlatItem, isTypeAheadKey, treeAction, typeAhead } from "./tree-nav.js";

const item = (pointer: string, over: Partial<FlatItem> = {}): FlatItem => ({
  pointer,
  label: pointer,
  level: 1,
  parent: null,
  hasChildren: false,
  expanded: false,
  collapsible: false,
  group: 0,
  ...over,
});

// Vehicle (open) > Details > Plate; Person (closed); then site items Sources, Theme.
const items: FlatItem[] = [
  item("veh", { label: "Vehicle", hasChildren: true, expanded: true, collapsible: true }),
  item("veh/details", {
    label: "Details",
    level: 2,
    parent: "veh",
    hasChildren: true,
    expanded: true,
  }),
  item("veh/plate", { label: "Plate", level: 3, parent: "veh/details" }),
  item("per", { label: "Person", hasChildren: true, collapsible: true }),
  item("sources", { label: "Sources", group: 1 }),
  item("theme", { label: "Theme", group: 1 }),
];
const act = (current: string, key: string) => treeAction(items, current, key);

describe("treeAction (WAI-ARIA tree keys)", () => {
  it("Up and Down move through the visible rows, and stop at the ends", () => {
    expect(act("veh", "ArrowDown")).toEqual({ kind: "focus", pointer: "veh/details" });
    expect(act("per", "ArrowUp")).toEqual({ kind: "focus", pointer: "veh/plate" });
    expect(act("veh", "ArrowUp")).toEqual({ kind: "none" });
    expect(act("theme", "ArrowDown")).toEqual({ kind: "none" });
  });

  it("Right opens a closed type, moves into an open one, and does nothing on a leaf", () => {
    expect(act("per", "ArrowRight")).toEqual({ kind: "expand", pointer: "per" });
    expect(act("veh", "ArrowRight")).toEqual({ kind: "focus", pointer: "veh/details" });
    expect(act("veh/plate", "ArrowRight")).toEqual({ kind: "none" });
    expect(act("sources", "ArrowRight")).toEqual({ kind: "none" });
  });

  it("Left closes an open type, else moves to the parent, and does nothing at the top", () => {
    expect(act("veh", "ArrowLeft")).toEqual({ kind: "collapse", pointer: "veh" });
    // A section cannot close: Left goes to its type.
    expect(act("veh/details", "ArrowLeft")).toEqual({ kind: "focus", pointer: "veh" });
    expect(act("veh/plate", "ArrowLeft")).toEqual({ kind: "focus", pointer: "veh/details" });
    expect(act("per", "ArrowLeft")).toEqual({ kind: "none" });
    expect(act("sources", "ArrowLeft")).toEqual({ kind: "none" });
  });

  it("a type a search holds open cannot close: Left does nothing at the top", () => {
    const searched = items.map((x) => (x.pointer === "veh" ? { ...x, collapsible: false } : x));
    expect(treeAction(searched, "veh", "ArrowLeft")).toEqual({ kind: "none" });
    expect(treeAction(searched, "per", "ArrowRight")).toEqual({ kind: "expand", pointer: "per" });
  });

  it("Home and End go to the first and last row of the row's own group", () => {
    expect(act("veh/plate", "Home")).toEqual({ kind: "focus", pointer: "veh" });
    expect(act("veh", "End")).toEqual({ kind: "focus", pointer: "per" });
    expect(act("theme", "Home")).toEqual({ kind: "focus", pointer: "sources" });
    expect(act("sources", "End")).toEqual({ kind: "focus", pointer: "theme" });
  });

  it("Enter and Space select the row; other keys do nothing", () => {
    expect(act("per", "Enter")).toEqual({ kind: "select", pointer: "per" });
    expect(act("per", " ")).toEqual({ kind: "select", pointer: "per" });
    expect(act("per", "Tab")).toEqual({ kind: "none" });
    expect(act("gone", "ArrowDown")).toEqual({ kind: "none" });
  });
});

describe("typeAhead", () => {
  it("finds the next row starting with the character, wrapping, ignoring case", () => {
    expect(typeAhead(items, "veh", "p")).toBe("veh/plate");
    expect(typeAhead(items, "veh/plate", "P")).toBe("per");
    expect(typeAhead(items, "per", "p")).toBe("veh/plate");
    expect(typeAhead(items, "veh", "s")).toBe("sources");
    expect(typeAhead(items, "veh", "z")).toBeNull();
  });

  it("a character key is one printable character with no command modifier", () => {
    const k = (key: string, mod: object = {}) =>
      isTypeAheadKey({ key, ctrlKey: false, metaKey: false, altKey: false, ...mod });
    expect(k("a")).toBe(true);
    expect(k("A")).toBe(true);
    expect(k(" ")).toBe(false);
    expect(k("Enter")).toBe(false);
    expect(k("a", { ctrlKey: true })).toBe(false);
    expect(k("a", { metaKey: true })).toBe(false);
  });
});
