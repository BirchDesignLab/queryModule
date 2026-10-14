import { createTranslator } from "@querymodule/client";
import { shortReference } from "@querymodule/web-ui";
import { describe, expect, it } from "vitest";
import { EN_BUNDLE } from "../test/en-bundle.js";
import { criticalAnnouncementText, statusAnnouncementText } from "./announce-status.js";

const { t } = createTranslator("en", EN_BUNDLE);
const label = (code: string) => code;
const base = { correlationId: "01923abc-c3d4-7e5f-8a9b-0c1d2e3f4a5b", queryType: "VEH" };
const SHORT = shortReference(base.correlationId);

describe("FR-044 the coalesced status sentence (spec 6.6)", () => {
  it("says counts and the short reference", () => {
    expect(
      statusAnnouncementText(
        { ...base, summary: { done: 2, total: 2, byStatus: { returned: 2 }, notRun: 0 } },
        t,
        label,
      ),
    ).toBe(`VEH ${SHORT}: 2 of 2 sources done. 2 returned.`);
  });
  it("words timedOut as timed out and keeps pending last", () => {
    expect(
      statusAnnouncementText(
        {
          ...base,
          summary: {
            done: 2,
            total: 3,
            byStatus: { pending: 1, timedOut: 1, returned: 1 },
            notRun: 0,
          },
        },
        t,
        label,
      ),
    ).toBe(`VEH ${SHORT}: 2 of 3 sources done. 1 returned, 1 timed out, 1 pending.`);
  });
  it("#587 says how many sources were not run, after the status counts", () => {
    expect(
      statusAnnouncementText(
        { ...base, summary: { done: 1, total: 1, byStatus: { returned: 1 }, notRun: 1 } },
        t,
        label,
      ),
    ).toBe(`VEH ${SHORT}: 1 of 1 source done. 1 returned. 1 not run.`);
  });
  it("#576 with no status counts it says nothing dangling after the totals", () => {
    const text = statusAnnouncementText(
      { ...base, summary: { done: 0, total: 0, byStatus: {}, notRun: 2 } },
      t,
      label,
    );
    expect(text).toBe(`VEH ${SHORT}: 0 of 0 sources done. 2 not run.`);
  });
  it("ruling 12 names the request by its primary typed field, never a payload value", () => {
    const text = statusAnnouncementText(
      { ...base, summary: { done: 1, total: 2, byStatus: { returned: 1, pending: 1 }, notRun: 0 } },
      t,
      label,
      { typed: "ZZ-0001" },
    );
    expect(text).toBe("VEH ZZ-0001: 1 of 2 sources done. 1 returned, 1 pending.");
    expect(text).not.toContain(SHORT);
  });
  it("ruling 12 adds the highest severity and its configured keyword", () => {
    expect(
      statusAnnouncementText(
        { ...base, summary: { done: 2, total: 2, byStatus: { returned: 2 }, notRun: 0 } },
        t,
        label,
        { typed: "ZZ-0001", highest: { severity: "critical", keyword: "STOLEN" } },
      ),
    ).toBe("VEH ZZ-0001: 2 of 2 sources done. 2 returned, critical: STOLEN.");
  });
  it("severity alone still reads as a sentence when no counts by status exist", () => {
    expect(
      statusAnnouncementText(
        { ...base, summary: { done: 0, total: 0, byStatus: {}, notRun: 0 } },
        t,
        label,
        { highest: { severity: "warning", keyword: "EXPIRED" } },
      ),
    ).toBe(`VEH ${SHORT}: 0 of 0 sources done. warning: EXPIRED.`);
  });
  it("a critical result is one assertive sentence naming the request, keyword and source", () => {
    expect(
      criticalAnnouncementText(t, {
        name: "Vehicle ZZ-0001",
        keyword: "STOLEN",
        source: "State system",
      }),
    ).toBe("Vehicle ZZ-0001: critical: STOLEN, State system.");
  });
  it("one source reads singular", () => {
    expect(
      statusAnnouncementText(
        { ...base, summary: { done: 1, total: 1, byStatus: { failed: 1 }, notRun: 0 } },
        t,
        label,
      ),
    ).toBe(`VEH ${SHORT}: 1 of 1 source done. 1 failed.`);
  });
});
