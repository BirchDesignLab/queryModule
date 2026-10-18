import { describe, expect, it } from "vitest";
import { purgedValuesSummary, sourcesDoneLine } from "./result-view.js";

// BW3 Task 6 and #754: the status line under an entry and what is left of purged values. Counts
// and words only, never a value.

const MESSAGES: Record<string, string> = {
  "sourceStatus.detail": "{count} {status}",
  "sourceStatus.purgedDetail": "{count} purged",
  "sourceStatus.doneLine.one": "{done} of {count} source done. {details}.",
  "sourceStatus.doneLine.other": "{done} of {count} sources done. {details}.",
  "sourceStatus.doneLineBare.one": "{done} of {count} source done.",
  "sourceStatus.doneLineBare.other": "{done} of {count} sources done.",
  "sourceStatus.status.returned": "returned",
  "sourceStatus.status.timedOut": "timed out",
  "sourceStatus.status.pending": "pending",
};
const t = (key: string, params?: Record<string, string | number | boolean>) => {
  const form =
    params !== undefined && "count" in params && typeof params.count === "number"
      ? `${key}.${params.count === 1 ? "one" : "other"}`
      : key;
  return (MESSAGES[form] ?? MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) =>
    String(params?.[k] ?? `{${k}}`),
  );
};

describe("sourcesDoneLine", () => {
  it("counts done sources and names the statuses, terminal first and pending last", () => {
    expect(
      sourcesDoneLine([{ status: "returned" }, { status: "timedOut" }, { status: "pending" }], t),
    ).toBe("2 of 3 sources done. 1 returned, 1 timed out, 1 pending.");
  });

  it("says the purged count when retention took payloads", () => {
    expect(
      sourcesDoneLine(
        [
          { status: "returned", purged: true },
          { status: "returned", purged: true },
        ],
        t,
      ),
    ).toBe("2 of 2 sources done. 2 returned, 2 purged.");
    expect(sourcesDoneLine([{ status: "returned", purged: true }, { status: "returned" }], t)).toBe(
      "2 of 2 sources done. 2 returned, 1 purged.",
    );
  });

  it("uses the singular for one source", () => {
    expect(sourcesDoneLine([{ status: "returned" }], t)).toBe("1 of 1 source done. 1 returned.");
  });

  it("is empty for a request that went to no source", () => {
    expect(sourcesDoneLine([], t)).toBe("");
  });
});

describe("purgedValuesSummary", () => {
  it("joins the surviving type values and is empty when none survive", () => {
    expect(purgedValuesSummary({ propertyType: "ARTICLE" })).toBe("ARTICLE");
    expect(purgedValuesSummary({ a: "X", b: "Y" })).toBe("X Y");
    expect(purgedValuesSummary({})).toBe("");
    expect(purgedValuesSummary(undefined)).toBe("");
  });
});
