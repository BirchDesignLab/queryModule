import { describe, expect, it } from "vitest";
import { defaultSite } from "./__fixtures__/sites";
import { fieldOf, isRest, namedFieldReader } from "./positions";

describe("spec 4.4 command positions", () => {
  it("fieldOf reads a plain or a rest position", () => {
    expect(fieldOf("plate")).toBe("plate");
    expect(fieldOf({ field: "description", rest: true })).toBe("description");
  });
  it("isRest is true only for a rest position", () => {
    expect(isRest({ field: "description", rest: true })).toBe(true);
    expect(isRest("plate")).toBe(false);
    expect(isRest(undefined)).toBe(false);
  });
});

describe("spec 4.4 namedFieldReader: text before the first = names a field key", () => {
  const named = namedFieldReader(defaultSite, "VEH");
  it("matches a field key case-insensitively, trimmed", () => {
    expect(named("plateType=PC")?.key).toBe("plateType");
    expect(named(" PLATETYPE = PC")?.key).toBe("plateType");
    expect(named("vin=a=b")?.key).toBe("vin");
  });
  it.each(["=PC", " =PC", "PC", "colour=RED", "ZZ=0001", ""])("%j reads as positional", (text) => {
    expect(named(text)).toBeUndefined();
  });
  it("a query type missing from the config names no field", () => {
    expect(namedFieldReader(defaultSite, "NOPE")("plate=x")).toBeUndefined();
  });
});
