import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { rowSummary } from "./row-summary.js";

const NOW = Date.UTC(2026, 9, 14);

describe("G7 a row listed after a reload gets its command back from the part's planned values", () => {
  it("keeps the summary the row was sent with", () => {
    expect(rowSummary(CLIENT_CONFIG, "VEH", "VEH.ABC123", { plate: "ZZ-0001" }, NOW)).toBe(
      "VEH.ABC123",
    );
  });

  it("rebuilds the command from the primary part's values when the row has none", () => {
    const text = rowSummary(CLIENT_CONFIG, "VEH", "", { plate: "ZZ-0001" }, NOW);
    expect(text.startsWith("VEH.ZZ-0001")).toBe(true);
  });

  it("is empty while the values have not arrived, and ignores values it cannot show", () => {
    expect(rowSummary(CLIENT_CONFIG, "VEH", "", undefined, NOW)).toBe("");
    expect(
      rowSummary(CLIENT_CONFIG, "VEH", "", { plate: { nested: 1 }, year: 26 }, NOW),
    ).not.toContain("nested");
  });
});

describe("polish 8: a rebuilt command never adds a default the user did not type", () => {
  it("leaves out a value that is the site default (the planned values are the effective ones)", () => {
    const plain = rowSummary(CLIENT_CONFIG, "VEH", "", { plate: "ZZ-0001" }, NOW);
    const withDefault = rowSummary(
      CLIENT_CONFIG,
      "VEH",
      "",
      { plate: "ZZ-0001", state: "TX" },
      NOW,
    );
    expect(withDefault).toBe(plain);
    expect(withDefault).not.toContain("TX");
  });

  it("keeps a State that differs from the default", () => {
    expect(rowSummary(CLIENT_CONFIG, "VEH", "", { plate: "ZZ-0001", state: "OK" }, NOW)).toContain(
      "OK",
    );
  });

  it("a driver's license by number alone reads as the number alone", () => {
    const text = rowSummary(
      CLIENT_CONFIG,
      "DL",
      "",
      { licenseNumber: "ZZDLTEST", state: "TX" },
      NOW,
    );
    expect(text).toBe("DL.ZZDLTEST");
  });
});
