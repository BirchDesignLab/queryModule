import { describe, expect, it } from "vitest";
import { resolvePersona } from "./resolve-persona.js";

describe("UX-001 persona from host, override, then device heuristic (spec 6.1)", () => {
  it.each([
    [
      "host context wins",
      { hostPersona: "records", override: "dispatch", platform: "web", coarsePointer: true },
      "records",
      "host",
      false,
    ],
    [
      "stored override next",
      { hostPersona: null, override: "dispatch", platform: "web", coarsePointer: true },
      "dispatch",
      "override",
      false,
    ],
    [
      "native means mobile",
      { hostPersona: null, override: null, platform: "native", coarsePointer: true },
      "mobile",
      "heuristic",
      false,
    ],
    [
      "coarse pointer means mobileUnit",
      { hostPersona: null, override: null, platform: "web", coarsePointer: true },
      "mobileUnit",
      "heuristic",
      true,
    ],
    [
      "fine pointer means dispatch",
      { hostPersona: null, override: null, platform: "web", coarsePointer: false },
      "dispatch",
      "heuristic",
      true,
    ],
  ] as const)("%s", (_name, input, persona, source, reevaluate) => {
    expect(resolvePersona(input)).toEqual({
      persona,
      source,
      reevaluateOnPointerChange: reevaluate,
    });
  });
  it("UX-012 has no width input, so zoom cannot change persona", () => {
    expect(resolvePersona.length).toBe(1);
  });
});
