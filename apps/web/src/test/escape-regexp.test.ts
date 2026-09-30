import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./escape-regexp.js";

describe("escapeRegExp", () => {
  it("escapes every regular-expression metacharacter, backslash included", () => {
    for (const ch of [".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"])
      expect(escapeRegExp(ch), ch).toBe(`\\${ch}`);
  });

  it("makes a pattern that matches exactly the text it was made from", () => {
    for (const text of ["plain", "a.b", "c++", "x|y", "[z]", "back\\slash", "(a)$", "^start{1}"]) {
      const re = new RegExp(`^${escapeRegExp(text)}$`);
      expect(re.test(text), text).toBe(true);
    }
    // The dot is a dot, not any character; the pipe is a pipe, not an alternation.
    expect(new RegExp(`^${escapeRegExp("a.b")}$`).test("axb")).toBe(false);
    expect(new RegExp(`^${escapeRegExp("x|y")}$`).test("x")).toBe(false);
  });

  it("leaves text with no metacharacters alone", () => {
    expect(escapeRegExp("Plate type plateType")).toBe("Plate type plateType");
  });
});
