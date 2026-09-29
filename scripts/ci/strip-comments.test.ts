import { describe, expect, it } from "vitest";
import { hasTaggedTest } from "./story-tags";
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

  it("a false line-comment match inside a regex literal is bounded to its own line", () => {
    // `/a\//` is not a string, so it is not quote-scanned; `\/` followed by
    // `/` is still read as a `//` line-comment start (a known, pre-existing
    // limitation of a scanner with no regex-literal awareness), but the
    // mis-scan must stop at the next newline rather than eating the rest of
    // the file.
    const source = 'const u = /a\\//; it("[A1] x")\nconst v = "b";\n';
    const out = stripComments(source);
    expect(out).toContain('const v = "b";');
  });
});

describe("stripComments regex-literal awareness (#220 G-M-a, r1-a)", () => {
  it("G-M-a: a quote inside a regex literal does not let a commented-out tagged test count as live", () => {
    const source = ["const r = /'/;", "/*", 'it("[A1] commented out", () => {})', "*/"].join("\n");
    expect(hasTaggedTest(source, "A1")).toBe(false);
  });

  it("G-M-a: a quote in a regex literal on the same line as a block-comment opener does not hide the opener", () => {
    const source = ["const r = /'/; /*", 'it("[A1] commented out", () => {})', "*/"].join("\n");
    expect(hasTaggedTest(source, "A1")).toBe(false);
  });

  it("r1-a: an escaped slash inside a regex literal does not open a line comment", () => {
    const source = 'const r = /a\\//; // it("[A1] x", () => {})';
    expect(hasTaggedTest(source, "A1")).toBe(false);
    expect(stripComments(source)).toBe("const r = /a\\//; ");
  });

  it("a real tagged test after a regex literal on the previous line is still live", () => {
    const source = ["const r = /'/;", 'it("[A1] real", () => {})'].join("\n");
    expect(hasTaggedTest(source, "A1")).toBe(true);
  });

  it("reads a character class containing / and a quote as part of the regex", () => {
    const source = "const r = /[/']+/g; // tail\nconst s = 1;";
    expect(stripComments(source)).toBe("const r = /[/']+/g; \nconst s = 1;");
  });

  it("still treats division as division", () => {
    expect(stripComments("const q = a / b; // c\n")).toBe("const q = a / b; \n");
    expect(stripComments("const q = (a) / 2; /* c */")).toBe("const q = (a) / 2; ");
  });

  it("fails closed when a regex candidate closes on a comment opener: plain mode keeps the comment stripped", () => {
    // The candidate `/'; /` closes on the `/` of `/*`; without plain mode the
    // stray `'` opens a string that hides the block-comment opener.
    const source = ["const r = /'; /*", 'it("[A1] x", () => {})', "*/", "const s = 1;"].join("\n");
    const out = stripComments(source);
    expect(out).not.toContain("[A1]");
    expect(out).toContain("const s = 1;");
    expect(hasTaggedTest(source, "A1")).toBe(false);
  });

  it("does not read a line-leading division slash as a regex (spec:S1)", () => {
    const source = 'const ratio = a\n  / b; // it("[A1] x", () => {})';
    expect(hasTaggedTest(source, "A1")).toBe(false);
  });

  it("does not let JSX self-closing slash swallow a comment opener (critic:C1)", () => {
    expect(hasTaggedTest('render(<X a={b} />); // it("[A1] x", () => {})', "A1")).toBe(false);
    const block = ["render(<X a={b} />); /*", 'it("[A1] x", () => {})', "*/"].join("\n");
    expect(hasTaggedTest(block, "A1")).toBe(false);
  });

  it("does not let a leading division slash hide a block comment opener (critic:C2)", () => {
    const source = ["const v = a", "  / 2; /*", 'it("[A1] x", () => {})', "*/"].join("\n");
    expect(hasTaggedTest(source, "A1")).toBe(false);
  });

  it("recognises a regex after => and other operators (critic:C3)", () => {
    const source = ["const f = (s) => /'/.test(s); /*", 'it("[A1] x", () => {})', "*/"].join("\n");
    expect(hasTaggedTest(source, "A1")).toBe(false);
    expect(stripComments("const g = x + /'/.source; // c")).toBe("const g = x + /'/.source; ");
  });

  it("G-I1: an ambiguous-start division candidate closing inside a string does not hide a comment", () => {
    const line = ["const x = a", `  / 2; const s = '/'; // it("[A1] x", () => {})`].join("\n");
    expect(hasTaggedTest(line, "A1")).toBe(false);
    const block = `const y = i++ / 2; const s = '/'; /* it("[A1] x", () => {}) */`;
    expect(hasTaggedTest(block, "A1")).toBe(false);
    const brace = ["if (a) {}", `/ 2; const s = "/"; // it("[A1] x", () => {})`].join("\n");
    expect(hasTaggedTest(brace, "A1")).toBe(false);
  });

  it("G-I1: an unambiguous start keeps a quoted regex literal regex-aware", () => {
    const source = [
      "const r = (/'/); /*",
      'it("[A1] x", () => {})',
      "*/",
      'it("[A1] live", () => {})',
    ].join("\n");
    const out = stripComments(source);
    expect(out).not.toContain('"[A1] x"');
    expect(out).toContain('"[A1] live"');
    expect(stripComments("const r = /'/; // c")).toBe("const r = /'/; ");
  });
});
