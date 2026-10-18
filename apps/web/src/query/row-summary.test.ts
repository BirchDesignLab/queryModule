import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { formToTerminal } from "./form-to-terminal.js";
import { rowSummary, savedEntryCommand } from "./row-summary.js";

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

describe("#680 N1: one canonical form in the saved entry", () => {
  it("a fresh entry typed with 26 and the same request rebuilt after a reload read the same", () => {
    const typed = { plate: "ZZ-0001", year: "26" };
    const fresh = savedEntryCommand(CLIENT_CONFIG, "VEH", typed, NOW);
    const reloaded = rowSummary(CLIENT_CONFIG, "VEH", "", { plate: "ZZ-0001", year: "2026" }, NOW);
    expect(fresh).toBe(reloaded);
    expect(fresh).toContain("..2026");
  });

  it("a fresh entry with the default State typed and the reloaded row read the same", () => {
    const fresh = savedEntryCommand(
      CLIENT_CONFIG,
      "VEH",
      { plate: "ZZ-0001", state: "TX", year: "26" },
      NOW,
    );
    const reloaded = rowSummary(
      CLIENT_CONFIG,
      "VEH",
      "",
      { plate: "ZZ-0001", state: "TX", year: "2026" },
      NOW,
    );
    expect(fresh).toBe(reloaded);
    expect(fresh).not.toContain("TX");
  });

  it("a request typed with the NAM alias and the same request rebuilt after a reload read the same (ruling B)", () => {
    const values = { last: "TESTERSON", first: "SAMPLE" };
    const fresh = savedEntryCommand(CLIENT_CONFIG, "PER", values, NOW);
    expect(fresh).toBe("PER.TESTERSON.SAMPLE");
    expect(rowSummary(CLIENT_CONFIG, "PER", "", values, NOW)).toBe(fresh);
  });

  it("a State that is not the default stays in the fresh entry", () => {
    expect(savedEntryCommand(CLIENT_CONFIG, "VEH", { plate: "ZZ-0001", state: "OK" }, NOW)).toBe(
      "VEH.ZZ-0001.OK",
    );
  });

  it("the command echo of the form still keeps the year as typed (R11, input only)", () => {
    expect(
      formToTerminal(CLIENT_CONFIG, "VEH", { plate: "ZZ-0001", year: "26" }, NOW).text,
    ).toContain("..26");
  });
});
