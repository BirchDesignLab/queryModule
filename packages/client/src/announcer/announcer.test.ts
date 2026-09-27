import { describe, expect, it, vi } from "vitest";
import { createAnnouncer } from "./announcer.js";

describe("FR-005 announcer queue (spec 6.6)", () => {
  it("routes polite and assertive messages to their own slot with rising ids", () => {
    const announcer = createAnnouncer();
    const listener = vi.fn();
    announcer.subscribe(listener);
    const first = announcer.announce("2 fields need attention");
    const second = announcer.announce("critical", "assertive");
    expect(announcer.current()).toEqual({ polite: first, assertive: second });
    expect(second.id).toBeGreaterThan(first.id);
    expect(first.politeness).toBe("polite");
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("keeps the snapshot reference stable until something changes", () => {
    const announcer = createAnnouncer();
    expect(announcer.current()).toBe(announcer.current());
  });
  it("clear empties both slots and unsubscribe stops notifications", () => {
    const announcer = createAnnouncer();
    const listener = vi.fn();
    const off = announcer.subscribe(listener);
    announcer.announce("x");
    off();
    announcer.clear();
    expect(announcer.current()).toEqual({ polite: null, assertive: null });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
