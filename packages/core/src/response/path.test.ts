import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { childPath, resolvePath } from "./path";

const PAYLOAD = {
  plate: "ZZ-0001",
  vehicle: { year: 1901, "make.model": "TESTMAKE" },
  warrants: [
    { offense: "SAMPLE OFFENSE ONE", issued: "1901-02-03" },
    { offense: "SAMPLE OFFENSE TWO" },
    { issued: "1901-04-05" },
  ],
  tags: ["ALPHA", "BETA"],
  nested: [{ items: [{ n: 1 }, { n: 2 }] }, { items: [{ n: 3 }] }],
  "": { empty: "E" },
};

describe("resolvePath", () => {
  it("resolves dot segments", () => {
    expect(resolvePath(PAYLOAD, "plate")).toEqual(["ZZ-0001"]);
    expect(resolvePath(PAYLOAD, "vehicle.year")).toEqual([1901]);
  });

  it("resolves [n] array index", () => {
    expect(resolvePath(PAYLOAD, "tags[1]")).toEqual(["BETA"]);
    expect(resolvePath(PAYLOAD, "warrants[0].offense")).toEqual(["SAMPLE OFFENSE ONE"]);
  });

  it("resolves bracket-quoted keys, including dots and the empty key", () => {
    expect(resolvePath(PAYLOAD, 'vehicle["make.model"]')).toEqual(["TESTMAKE"]);
    expect(resolvePath(PAYLOAD, '[""].empty')).toEqual(["E"]);
  });

  it("projects [*] and skips elements where the rest does not resolve", () => {
    expect(resolvePath(PAYLOAD, "warrants[*].offense")).toEqual([
      "SAMPLE OFFENSE ONE",
      "SAMPLE OFFENSE TWO",
    ]);
    expect(resolvePath(PAYLOAD, "tags[*]")).toEqual(["ALPHA", "BETA"]);
  });

  it("flattens nested projections", () => {
    expect(resolvePath(PAYLOAD, "nested[*].items[*].n")).toEqual([1, 2, 3]);
  });

  it("returns the array itself for a plain path to an array", () => {
    expect(resolvePath(PAYLOAD, "tags")).toEqual([["ALPHA", "BETA"]]);
  });

  it("returns an empty list for unresolved or malformed paths", () => {
    for (const p of [
      "",
      "missing",
      "plate.x",
      "tags[5]",
      "tags.length",
      "warrants[*",
      "warrants[x]",
      ".plate",
      "plate.",
      "a..b",
      '["unterminated',
      "[-1]",
    ]) {
      expect(resolvePath(PAYLOAD, p)).toEqual([]);
    }
  });

  it("never reads inherited members", () => {
    expect(resolvePath({}, "__proto__")).toEqual([]);
    expect(resolvePath({}, "constructor")).toEqual([]);
    expect(resolvePath({}, "toString")).toEqual([]);
  });

  it("round-trips childPath for awkward keys", () => {
    const keys = ["plain", "a.b", "has space", 'q"uote', "back\\slash", "br[ack]et", ""];
    for (const k of keys) {
      const payload = { [k]: { leaf: "V" } };
      expect(resolvePath(payload, `${childPath("", k)}.leaf`)).toEqual(["V"]);
    }
    expect(resolvePath({ list: ["x", "y"] }, childPath("list", 1))).toEqual(["y"]);
  });

  it("never throws on arbitrary JSON and paths", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.string(), (value, path) => {
        expect(Array.isArray(resolvePath(value, path))).toBe(true);
      }),
    );
    const pathPieces = fc.constantFrom("a", "b", ".", "[0]", "[*]", '["a"]', "[", "]", '"', "\\");
    fc.assert(
      fc.property(fc.jsonValue(), fc.array(pathPieces, { maxLength: 8 }), (value, parts) => {
        expect(Array.isArray(resolvePath(value, parts.join("")))).toBe(true);
      }),
    );
  });

  it("never throws when [*] projects a very large array (CW critic 1)", () => {
    const big = { list: Array.from({ length: 300_000 }, (_, i) => i) };
    expect(resolvePath(big, "list[*]")).toHaveLength(300_000);
  });
});
