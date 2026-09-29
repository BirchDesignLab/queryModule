import { evaluateForm } from "@querymodule/core/rules";
import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { valuesToSend } from "./send-values.js";

// #382 A5 with the shipped VEH: State default TX, Plate type shown and required for another state.
const NOW = Date.UTC(2026, 8, 29);
const stateOf = (values: Record<string, string>) =>
  evaluateForm(CLIENT_CONFIG, "VEH", values, { now: NOW });
const send = (values: Record<string, string>) =>
  valuesToSend(CLIENT_CONFIG, "VEH", values, stateOf(values), NOW);

describe("valuesToSend (#382 A5, FR-012, spec 4.3 step 6)", () => {
  it("drops a value a rule hides when the mode is unchanged", () => {
    const values = { plate: "ZZ-0001", state: "TX", plateType: "PC" };
    expect(stateOf(values).hiddenWithValue).toEqual(["plateType"]);
    expect(send(values)).toEqual({ plate: "ZZ-0001", state: "TX" });
  });

  it("sends the draft as it is when dropping would turn normal into plate-only", () => {
    // State left empty (the site default applies) with a kept Plate type: the form is normal, but
    // the pruned body would be plate-only and the server would answer modeMismatch.
    const values = { plate: "ZZ-0001", state: "", plateType: "PC" };
    const state = stateOf(values);
    expect(state.mode).toBe("normal");
    expect(state.hiddenWithValue).toEqual(["plateType"]);
    expect(send(values)).toBe(values);
  });

  it("returns the same object when nothing is hidden", () => {
    const values = { plate: "ZZ-0001" };
    expect(send(values)).toBe(values);
  });
});
