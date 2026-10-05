import type { MockFile } from "@querymodule/core/contracts";
import type * as Builders from "../builders";

/** Scenario table for the default site (spec 5.4): triggers, sources, behaviours and latency as code. */
export const site = (b: typeof Builders): MockFile => {
  const none = { status: "NO RECORD" };
  const p = b.plate(1);
  return {
    siteId: "default",
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
          {
            queryType: "PRO",
            default: none,
            scenarios: [
              { when: { serial: "ZZSTOLEN1" }, respond: b.propertyRecord({ serial: "ZZSTOLEN1" }) },
            ],
          },
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
          {
            queryType: "PRO",
            default: none,
            scenarios: [
              { when: { serial: "ZZSTOLEN1" }, respond: b.propertyRecord({ serial: "ZZSTOLEN1" }) },
            ],
          },
          {
            queryType: "WNT",
            default: { status: "NO WANTS OR WARRANTS" },
            scenarios: [
              { when: { last: "WANTED" }, respond: b.warrantRecord({ n: 1 }) },
              { when: { last: "MISSING" }, respond: b.missingRecord({ n: 3 }) },
            ],
          },
          { queryType: "DL", default: none, scenarios: [] },
        ],
      },
    },
  };
};
