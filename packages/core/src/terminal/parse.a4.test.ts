import { describe, expect, it } from "vitest";
import { defaultSite } from "./__fixtures__/sites";
import { parseCommand } from "./parse";

const now = Date.UTC(2026, 8, 28);

describe("[A4] terminal parser (FR-050 to FR-055)", () => {
  it("[A4] VEH.ABC123..26 runs with Plate=ABC123, State=TX (default), Year=2026", () => {
    const r = parseCommand(defaultSite, "VEH.ABC123..26", { now });
    expect(r.errors).toEqual([]);
    expect(r.queryType).toBe("VEH");
    expect(r.formState?.values).toEqual({ plate: "ABC123", state: "TX", year: 2026 });
    expect(r.formState?.valid).toBe(true);
  });
  it("[A4] XYZ.123 is an unrecognized command error", () => {
    expect(parseCommand(defaultSite, "XYZ.123", { now })).toEqual({
      userValues: {},
      errors: [{ key: "terminal.unknownCommand", params: { code: "XYZ" } }],
    });
  });
});
