import { evaluateForm } from "@querymodule/core/rules";
import { describe, expect, it } from "vitest";
import { CLIENT_CONFIG } from "../test/msw-server.js";
import { valuesToSend } from "./send-values.js";

// #382 A5 with the shipped VEH: State default TX, Plate type shown and required for another state.
const NOW = Date.UTC(2026, 8, 29);
const stateOf = (values: Record<string, string>) =>
  evaluateForm(CLIENT_CONFIG, "VEH", values, { now: NOW });
const send = (values: Record<string, string>) => valuesToSend(values, stateOf(values));

describe("valuesToSend (#382 A5, FR-012, spec 4.3 step 6)", () => {
  it("drops a value a rule hides when the mode is unchanged", () => {
    const values = { plate: "ZZ-0001", state: "TX", plateType: "PC" };
    expect(stateOf(values).hiddenWithValue).toEqual(["plateType"]);
    expect(send(values)).toEqual({ plate: "ZZ-0001", state: "TX" });
  });

  it("SUBMIT-2 a stale hidden Plate type stays out of a plate-only query, and the national source with it", () => {
    // State left empty (the site default applies) with a Plate type kept from an earlier out-of-state
    // query: hidden values never decide the mode, so this is plate-only, and the body drops it.
    const values = { plate: "ZZ-0001", state: "", plateType: "PC" };
    const state = stateOf(values);
    expect(state.mode).toBe("plateOnly");
    expect(state.hiddenWithValue).toEqual(["plateType"]);
    const sent = send(values);
    expect(sent).toEqual({ plate: "ZZ-0001", state: "" });
    // What the server evaluates from the body it receives: the same mode, so the planner narrows to
    // the plate-only sources (spec 4.6 step 3) and the national source is not asked.
    const server = stateOf(sent as Record<string, string>);
    expect(server.mode).toBe("plateOnly");
    expect(server.sources.filter((x) => x.plateOnly).map((x) => x.sourceId)).toEqual([
      "stateSource",
    ]);
  });

  it("returns the same object when nothing is hidden", () => {
    const values = { plate: "ZZ-0001" };
    expect(send(values)).toBe(values);
  });
});
