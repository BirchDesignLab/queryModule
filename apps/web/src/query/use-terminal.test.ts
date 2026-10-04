import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { formToTerminal } from "./form-to-terminal.js";
import { terminalToForm } from "./use-terminal.js";

const NOW = Date.UTC(2026, 8, 29);

describe("FR-056 form to terminal (spec 4.4 Toggle)", () => {
  it("[A5] writes the command from user values and counts the fields it cannot show", () => {
    const r = formToTerminal(
      CLIENT_CONFIG,
      "VEH",
      { plate: "ZZ-0001", state: "OK", plateType: "PC" },
      NOW,
    );
    expect(r).toEqual({ text: "VEH.ZZ-0001.OK", unshown: 1 });
  });

  it("an empty draft gives the bare command and nothing unshown", () => {
    expect(formToTerminal(CLIENT_CONFIG, "VEH", {}, NOW)).toEqual({ text: "VEH", unshown: 0 });
  });
});

describe("FR-056 terminal to form (spec 4.4 Toggle, #297 item 1)", () => {
  it("[A5] merges the command into the draft of its type and keeps other values", () => {
    const r = terminalToForm(CLIENT_CONFIG, "VEH.ZZ-0002.OK..", {
      VEH: { plate: "ZZ-0001", state: "OK", plateType: "PC" },
    });
    expect(r).toEqual({
      queryType: "VEH",
      values: { plate: "ZZ-0002", state: "OK", plateType: "PC", year: "", vin: "" },
    });
  });

  it("switches to the type the command names and leaves the other drafts alone", () => {
    const r = terminalToForm(CLIENT_CONFIG, "PER.TESTERSON", { VEH: { plate: "ZZ-0001" } });
    expect(r?.queryType).toBe("PER");
    expect(r?.values).toMatchObject({ last: "TESTERSON" });
  });

  it("[A4] a failing command reads what it can; an unknown command changes nothing", () => {
    expect(terminalToForm(CLIENT_CONFIG, "VEH.ZZ-0002.OK.1.2.3.4.5", {})?.values).toMatchObject({
      plate: "ZZ-0002",
    });
    expect(terminalToForm(CLIENT_CONFIG, "XYZ.123", {})).toBeNull();
  });
});
