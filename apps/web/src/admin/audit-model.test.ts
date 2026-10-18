import { describe, expect, it } from "vitest";
import {
  auditDetailRows,
  defaultWindow,
  formatWindowTime,
  parseWindowTime,
  validateAuditForm,
} from "./audit-model.js";

const NOON = new Date(2026, 9, 17, 12, 30, 0).getTime();

describe("window time text (local MM-DD-YY HH:mm)", () => {
  it("formats and parses the same text", () => {
    expect(formatWindowTime(NOON)).toBe("10-17-26 12:30");
    expect(parseWindowTime("10-17-26 12:30")).toBe(NOON);
  });

  it("rejects text that is not a real date and time", () => {
    for (const bad of [
      "",
      "2026-10-17 12:30",
      "13-01-26 00:00",
      "02-30-26 00:00",
      "10-17-26 24:00",
    ])
      expect(parseWindowTime(bad), bad).toBeNull();
  });

  it("defaults to the last 24 hours", () => {
    const w = defaultWindow(NOON);
    expect(parseWindowTime(w.to)).toBe(NOON);
    expect(parseWindowTime(w.from)).toBe(NOON - 86_400_000);
  });
});

describe("validateAuditForm", () => {
  const base = {
    user: "",
    correlationId: "",
    type: "",
    from: "10-01-26 00:00",
    to: "10-02-26 00:00",
  };

  it("a valid form gives filters with the To minute included and empty filters dropped", () => {
    const r = validateAuditForm(base);
    expect(r.errors).toEqual({});
    expect(r.filters).toEqual({
      from: parseWindowTime("10-01-26 00:00"),
      to: (parseWindowTime("10-02-26 00:00") as number) + 59_999,
    });
  });

  it("keeps the user, request id and event when set", () => {
    const id = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    const r = validateAuditForm({
      ...base,
      user: " user-0001 ",
      correlationId: id,
      type: "adminViewed",
    });
    expect(r.filters).toMatchObject({ user: "user-0001", correlationId: id, type: "adminViewed" });
  });

  it("names each bad field with a message key", () => {
    const r = validateAuditForm({ ...base, from: "x", to: "y", correlationId: "nope" });
    expect(r.filters).toBeNull();
    expect(r.errors).toEqual({
      from: "admin.audit.error.dateFrom",
      to: "admin.audit.error.dateTo",
      correlationId: "admin.audit.error.requestId",
    });
  });

  it("blocks a window over 31 days and a To before From", () => {
    expect(validateAuditForm({ ...base, to: "11-05-26 00:00" }).errors).toEqual({
      to: "admin.audit.error.span",
    });
    expect(validateAuditForm({ ...base, to: "09-30-26 00:00" }).errors).toEqual({
      to: "admin.audit.error.order",
    });
  });

  it("allows exactly 31 days", () => {
    expect(
      validateAuditForm({ ...base, from: "10-01-26 00:00", to: "11-01-26 00:00" }).errors,
    ).toEqual({});
  });
});

describe("auditDetailRows", () => {
  it("lists keys and values as stored, epoch keys with their local time", () => {
    const rows = auditDetailRows({ olderThan: NOON, rowCount: 3, ok: true, note: null, name: "x" });
    expect(rows).toEqual([
      { key: "olderThan", value: `${NOON} (10-17-26 12:30:00)` },
      { key: "rowCount", value: "3" },
      { key: "ok", value: "true" },
      { key: "note", value: "null" },
      { key: "name", value: "x" },
    ]);
  });

  it("writes nested values as JSON and returns no rows for no details", () => {
    expect(auditDetailRows({ keys: ["a", "b"] })).toEqual([{ key: "keys", value: '["a","b"]' }]);
    expect(auditDetailRows({})).toEqual([]);
  });
});
