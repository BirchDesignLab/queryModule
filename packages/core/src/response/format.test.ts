import { describe, expect, it } from "vitest";
import { formatValue } from "./format";

describe("formatValue", () => {
  it("renders text and absent formats as strings", () => {
    expect(formatValue("abc", undefined, "en-US")).toBe("abc");
    expect(formatValue("abc", { type: "text" }, "en-US")).toBe("abc");
    expect(formatValue(true, undefined, "en-US")).toBe("true");
    expect(formatValue(null, undefined, "en-US")).toBe("");
  });

  it("upper-cases through the locale", () => {
    expect(formatValue("sample", { type: "upper" }, "en-US")).toBe("SAMPLE");
    expect(formatValue("i", { type: "upper" }, "tr")).toBe("İ");
  });

  it("formats numbers through Intl without grouping (years stay years)", () => {
    expect(formatValue(1901, undefined, "en-US")).toBe("1901");
    expect(formatValue(1234.5, undefined, "en-US")).toBe("1234.5");
    expect(formatValue(1234.5, undefined, "de-DE")).toBe("1234,5");
  });

  it("falls back to en-US for an invalid locale tag", () => {
    expect(formatValue(1.5, undefined, "not a locale!")).toBe("1.5");
    expect(formatValue("a", { type: "upper" }, "not a locale!")).toBe("A");
  });

  it("formats phone numbers of 10 or 11 digits, else passes through", () => {
    expect(formatValue("5550100123", { type: "phone" }, "en-US")).toBe("(555) 010-0123");
    expect(formatValue("1-555-010-0123", { type: "phone" }, "en-US")).toBe("+1 (555) 010-0123");
    expect(formatValue("555-0100", { type: "phone" }, "en-US")).toBe("555-0100");
  });

  it("formats ISO dates with the pattern", () => {
    const f = (pattern: string) => ({ type: "date", pattern }) as const;
    expect(formatValue("1901-02-03", f("MM-DD-YY"), "en-US")).toBe("02-03-01");
    expect(formatValue("1901-02-03", f("MM/DD/YYYY"), "en-US")).toBe("02/03/1901");
    expect(formatValue("1901-02-03", f("DD.MM.YY"), "en-US")).toBe("03.02.01");
  });

  it("passes a non-date through a date format unchanged", () => {
    const f = { type: "date", pattern: "MM-DD-YY" } as const;
    expect(formatValue("NOT A DATE", f, "en-US")).toBe("NOT A DATE");
    expect(formatValue("1901-02-30", f, "en-US")).toBe("1901-02-30");
    expect(formatValue(5, f, "en-US")).toBe("5");
  });

  it("shows an ISO date as MM-DD-YY by default (spec 6.7)", () => {
    expect(formatValue("1901-02-03", undefined, "en-US")).toBe("02-03-01");
    expect(formatValue("1901-02-03", { type: "text" }, "en-US")).toBe("1901-02-03");
  });

  it("fills {value} in a template, leaving other braces alone", () => {
    const t = (template: string) => ({ type: "template", template }) as const;
    expect(formatValue("ZZ-0001", t("Plate {value}"), "en-US")).toBe("Plate ZZ-0001");
    expect(formatValue(7, t("{value}/{value} {other}"), "en-US")).toBe("7/7 {other}");
    expect(formatValue("$&", t("[{value}]"), "en-US")).toBe("[$&]");
  });
});
