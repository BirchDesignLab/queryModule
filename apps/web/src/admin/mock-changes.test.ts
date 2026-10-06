import type { Translator } from "@querymodule/client";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "./draft.js";
import { mockChangeEntries } from "./mock-changes.js";
import { mockPointer } from "./mock-edit.js";

// #571 minor, carried into PR 3 (#551): a Review line opens the response it is about, even when two
// responses of one source share a query type. Synthetic ids only (ZZ-####); no payload in any line.

const t = ((key: string) => key) as Translator["t"];
const names = { source: (id: string) => id, type: (code: string) => code };

const response = (types: Record<string, string> | undefined, plate: string) => ({
  queryType: "PRO",
  ...(types === undefined ? {} : { types }),
  default: { status: "NO RECORD" },
  scenarios: [{ when: { plate }, behavior: "error" }],
});

const file = (responses: unknown[]): JsonObject => ({
  siteId: "default",
  sources: { stateSource: { latencyMs: [50, 400], responses } },
});

describe("mockChangeEntries: which response a line opens", () => {
  it("opens the second response when only the second of two with one query type changed", () => {
    const live = file([response({ kind: "A" }, "ZZ-0001"), response({ kind: "B" }, "ZZ-0002")]);
    const edited = file([response({ kind: "A" }, "ZZ-0001"), response({ kind: "B" }, "ZZ-0003")]);
    const entries = mockChangeEntries(live, edited, names, t);
    expect(entries.map((e) => e.target)).toEqual([mockPointer.response("stateSource", 1)]);
  });

  it("opens the first response when only the first changed", () => {
    const live = file([response({ kind: "A" }, "ZZ-0001"), response({ kind: "B" }, "ZZ-0002")]);
    const edited = file([response({ kind: "A" }, "ZZ-0009"), response({ kind: "B" }, "ZZ-0002")]);
    const entries = mockChangeEntries(live, edited, names, t);
    expect(entries.map((e) => e.target)).toEqual([mockPointer.response("stateSource", 0)]);
  });

  it("opens an added response, not the one of the same type that was there", () => {
    const live = file([response({ kind: "A" }, "ZZ-0001")]);
    const edited = file([response({ kind: "A" }, "ZZ-0001"), response({ kind: "B" }, "ZZ-0002")]);
    const entries = mockChangeEntries(live, edited, names, t);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.target).toBe(mockPointer.response("stateSource", 1));
  });

  it("opens the source when the response is gone", () => {
    const live = file([response({ kind: "A" }, "ZZ-0001"), response({ kind: "B" }, "ZZ-0002")]);
    const edited = file([response({ kind: "A" }, "ZZ-0001")]);
    const entries = mockChangeEntries(live, edited, names, t);
    expect(entries.map((e) => e.target)).toEqual([mockPointer.source("stateSource")]);
  });

  it("carries no trigger value or payload in a line", () => {
    const live = file([response({ kind: "A" }, "ZZ-0001")]);
    const edited = file([response({ kind: "A" }, "ZZ-0777")]);
    const text = JSON.stringify(mockChangeEntries(live, edited, names, t));
    expect(text).not.toContain("ZZ-0777");
    expect(text).not.toContain("ZZ-0001");
  });
});
