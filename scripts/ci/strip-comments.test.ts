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

  it("bounds an unterminated quote to its own line, so a mis-scan cannot cross a newline (review C1)", () => {
    // A lone `"` inside a regex literal must not flip string parity for the
    // rest of the file: without the newline bound, this swallowed the
    // commented-out tagged test on the next line, making hasTaggedTest
    // fail-open (report a commented-out test as live).
    const source = 'const re = /"/;\n// it("[A1] x", () => {})\nconst s = "a";\n';
    const out = stripComments(source);
    // The commented line must be recognised and stripped as a comment.
    expect(out).not.toContain('it("[A1] x"');
    // Code after the false-quote line survives untouched.
    expect(out).toContain('const s = "a";');
  });

  it("does not read // inside a regex literal as a line comment (#220 r1-a)", () => {
    const source = 'const u = /a//; it("[A1] x", () => {})\nconst v = "b";\n';
    const out = stripComments(source);
    expect(out).toContain('it("[A1] x"');
    expect(out).toContain('const v = "b";');
    expect(stripComments("x = a / b; // real\n")).toBe("x = a / b; \n");
    expect(stripComments("x = [/[/]//]; // real\n")).toBe("x = [/[/]//]; \n");
  });

  it("keeps the issue's exact case, an escaped slash inside a regex literal (#220 r1-a)", () => {
    const source = 'const u = /a\\//; it("[A1] x", () => {})\nconst v = "b";\n';
    const out = stripComments(source);
    expect(out).toContain('it("[A1] x"');
    expect(out).toContain('const v = "b";');
  });

  it("strips a comment after a JSX closing tag or a line-leading division (round 1 C1)", () => {
    const tagged = 'it("[A1] x", () => {})';
    expect(
      stripComments(`render(<p>hi</p>); // ${tagged}
`),
    ).not.toContain(tagged);
    expect(
      stripComments(`const a = b
/ c; // ${tagged}
`),
    ).not.toContain(tagged);
  });
});
