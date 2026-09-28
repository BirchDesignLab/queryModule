import { describe, expect, it } from "vitest";
import { stripComments } from "./strip-comments";

describe("stripComments (item 7)", () => {
  it("removes line and block comments outside strings", () => {
    expect(stripComments("a(); // x\n")).toBe("a(); \n");
    expect(stripComments("a(/* x */);")).toBe("a();");
    expect(stripComments("a();\n/* multi\nline */\nb();")).toBe("a();\n\nb();");
  });

  it("does not treat // or /* inside a string or template literal as a comment", () => {
    expect(stripComments('const u = "http://x"; // real comment\n')).toBe(
      'const u = "http://x"; \n',
    );
    expect(stripComments('const u = "a/*b";')).toBe('const u = "a/*b";');
    expect(stripComments("const u = `a//b`;")).toBe("const u = `a//b`;");
  });

  it("does not let a marker inside one string reach across to a later string", () => {
    const source = ['const a = "/*";', "code();", 'const b = "*/";'].join("\n");
    expect(stripComments(source)).toBe(source);
  });

  it("respects escaped quotes inside a string", () => {
    expect(stripComments('const s = "a\\"// still string";')).toBe(
      'const s = "a\\"// still string";',
    );
  });
});
