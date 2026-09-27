import { describe, expect, it } from "vitest";
import { isCalendarDate, parseDate, resolveYear } from "./dates.js";

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);

describe("FR-005 two-digit and four-digit years (spec 4.3, 11)", () => {
  it.each([
    ["2026", "2000", 2026],
    ["26", "2000", 2026],
    ["99", "2000", 2099],
    ["26", "past", 2026],
    ["27", "past", 1927],
    ["99", "past", 1999],
    ["0999", "2000", null],
    ["2", "2000", null],
    ["abc", "past", null],
  ] as const)("resolveYear(%s, %s) = %s", (text, century, expected) => {
    expect(resolveYear(text, century, NOW)).toBe(expected);
  });
});

describe("FR-005 date formats (spec 4.3 step 2)", () => {
  it.each([
    ["09252026", "MMDDYYYY", "2026-09-25"],
    ["09/25/2026", "MM/DD/YYYY", "2026-09-25"],
    ["09-25-2026", "MM-DD-YYYY", "2026-09-25"],
    ["2026-09-25", "YYYY-MM-DD", "2026-09-25"],
    ["25.09.2026", "DD.MM.YYYY", "2026-09-25"],
    ["2024-02-29", "YYYY-MM-DD", "2024-02-29"],
    ["2026-02-29", "YYYY-MM-DD", null],
    ["13012026", "MMDDYYYY", null],
    ["09/25/2026", "MMDDYYYY", null],
    ["2026925", "MMDDYYYY", null],
  ] as const)("parseDate(%s, %s) = %s", (text, format, expected) => {
    expect(parseDate(text, format, "2000", NOW)).toBe(expected);
  });

  it("resolves YY by century", () => {
    expect(parseDate("092526", "MMDDYY", "past", NOW)).toBe("2026-09-25");
    expect(parseDate("010199", "MMDDYY", "past", NOW)).toBe("1999-01-01");
    expect(parseDate("010199", "MMDDYY", "2000", NOW)).toBe("2099-01-01");
  });

  it("rejects a format with no year", () => {
    expect(parseDate("0925", "MMDD", "2000", NOW)).toBeNull();
  });

  it("checks calendar dates", () => {
    expect(isCalendarDate(2026, 4, 31)).toBe(false);
    expect(isCalendarDate(2026, 4, 30)).toBe(true);
    expect(isCalendarDate(2026, 0, 1)).toBe(false);
    expect(isCalendarDate(999, 1, 1)).toBe(false);
  });
});
