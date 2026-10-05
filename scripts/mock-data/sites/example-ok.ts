import type { MockFile } from "@querymodule/core/contracts";
import type * as Builders from "../builders";

/**
 * Scenario table for the example-ok site (spec 5.4). It extends the default site, so it carries
 * the same mock sources, but demos fewer scenarios: no PRO serial trigger and no MISSING person.
 */
export const site = (b: typeof Builders): MockFile => {
  const none = { status: "NO RECORD" };
  const p = b.plate(1);
  return {
    siteId: "example-ok",
    sources: {
      stateSource: {
        latencyMs: [50, 400],
        responses: [
          {
            queryType: "VEH",
            default: none,
            scenarios: [
              {
                when: { plate: p },
                respond: b.vehicleRecord({ plate: p, status: "STOLEN", n: 1 }),
              },
              {
                when: { plate: "ABC123" },
                respond: b.vehicleRecord({ plate: "ABC123", status: "NO RECORD", n: 0 }),
              },
              { when: { plate: "FAIL1" }, behavior: "error" },
            ],
          },
          { queryType: "PER", default: none, scenarios: [] },
          { queryType: "PRO", default: none, scenarios: [] },
          { queryType: "DL", default: none, scenarios: [] },
        ],
      },
      nationalSource: {
        latencyMs: [100, 800],
        responses: [
          {
            queryType: "VEH",
            default: none,
            scenarios: [
              {
                when: { plate: p },
                respond: b.vehicleRecord({ plate: p, status: "STOLEN", n: 1, summary: true }),
              },
              { when: { plate: "TIMEOUT" }, behavior: "timeout" },
            ],
          },
          { queryType: "PER", default: none, scenarios: [] },
          { queryType: "PRO", default: none, scenarios: [] },
          {
            queryType: "WNT",
            default: { status: "NO WANTS OR WARRANTS" },
            scenarios: [{ when: { last: "WANTED" }, respond: b.warrantRecord({ n: 1 }) }],
          },
          { queryType: "DL", default: none, scenarios: [] },
        ],
      },
    },
  };
};
