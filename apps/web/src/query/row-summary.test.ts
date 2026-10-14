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
