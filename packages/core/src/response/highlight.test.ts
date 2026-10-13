import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { KeywordStyle } from "../config/schema";
import { highlight } from "./highlight";

const STOLEN: KeywordStyle = {
  keyword: "STOLEN",
  severity: "critical",
  except: ["NOT STOLEN", "RECOVERED STOLEN"],
};

describe("highlight", () => {
  it("marks STOLEN critical inside STOLEN VEHICLE", () => {
    expect(highlight("STOLEN VEHICLE", [STOLEN])).toEqual([
      { text: "STOLEN", severity: "critical", keyword: "STOLEN" },
      { text: " VEHICLE" },
    ]);
  });

  it.each(["NOT STOLEN", "RECOVERED STOLEN"])("except phrase %s suppresses the match", (t) => {
    expect(highlight(t, [STOLEN])).toEqual([{ text: t }]);
  });

  it.each(["STOLENX", "XSTOLEN", "ÉSTOLEN", "1STOLEN"])("boundary: %s does not match", (t) => {
    expect(highlight(t, [STOLEN])).toEqual([{ text: t }]);
  });

  it("matches case-insensitively and keeps the input case", () => {
    expect(highlight("Stolen", [STOLEN])).toEqual([
      { text: "Stolen", severity: "critical", keyword: "STOLEN" },
    ]);
  });

  it("NFC and NFD input agree", () => {
    const kw: KeywordStyle = { keyword: "CAFÉ", severity: "info" };
    const nfc = "un caf\u00e9 ici";
    const nfd = "un cafe\u0301 ici";
    expect(highlight(nfd, [kw])).toEqual(highlight(nfc, [kw]));
    expect(highlight(nfc, [kw])[1]).toMatchObject({ severity: "info" });
    expect(highlight(nfc, [{ keyword: "CAFE\u0301", severity: "info" }])).toEqual(
      highlight(nfc, [kw]),
    );
  });

  it("longest keyword wins over a shorter overlapping one", () => {
    const kws: KeywordStyle[] = [
      { keyword: "RECORD", severity: "warning" },
      { keyword: "NO RECORD", severity: "info" },
    ];
    expect(highlight("NO RECORD", kws)).toEqual([
      { text: "NO RECORD", severity: "info", keyword: "NO RECORD" },
    ]);
  });

  it("matches repeated occurrences", () => {
    const out = highlight("STOLEN, stolen", [STOLEN]);
    expect(out.filter((s) => s.severity === "critical")).toHaveLength(2);
  });

  it("treats regex metacharacters in keywords literally", () => {
    const kw: KeywordStyle = { keyword: "A+B(", severity: "warning" };
    expect(highlight("xx A+B( yy", [kw])[1]).toEqual({
      text: "A+B(",
      severity: "warning",
      keyword: "A+B(",
    });
    expect(highlight("AAB(", [kw])).toEqual([{ text: "AAB(" }]);
  });

  it("returns no segments for empty text and one plain segment with no keywords", () => {
    expect(highlight("", [STOLEN])).toEqual([]);
    expect(highlight("hello", [])).toEqual([{ text: "hello" }]);
  });

  it("property: segments concatenate back to the NFC input", () => {
    const kws: KeywordStyle[] = [
      STOLEN,
      { keyword: "NO RECORD", severity: "info" },
      { keyword: "WANTED", severity: "warning", except: ["NOT WANTED"] },
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            "STOLEN",
            "stolen",
            "NOT ",
            "NO RECORD",
            "WANTED",
            " ",
            "x",
            "É",
            "7",
            "-",
          ),
          { maxLength: 12 },
        ),
        (parts) => {
          const text = parts.join("");
          const segs = highlight(text, kws);
          expect(segs.map((s) => s.text).join("")).toBe(text.normalize("NFC"));
          expect(segs.every((s) => s.text.length > 0)).toBe(true);
        },
      ),
    );
  });
});
