import { describe, expect, it } from "vitest";
import type { KeywordStyle } from "../config/schema";
import { AssessmentSchema, SEVERITY_RANK } from "../contracts/assess";
import { assessResult } from "./assess";

const KEYWORDS: KeywordStyle[] = [
  { keyword: "STOLEN", severity: "critical", except: ["NOT STOLEN", "RECOVERED STOLEN"] },
  { keyword: "WANTED", severity: "warning" },
  { keyword: "NO RECORD", severity: "info" },
];

const STATE_PAYLOAD = {
  owner: { first: "SAMPLE", last: "TESTERSON" },
  plate: "ZZ-0001",
  remarks: "STOLEN VEHICLE",
  status: "STOLEN",
  vehicle: { year: 1901 },
};

describe("assessResult [A7]", () => {
  it("[A7] ZZ-0001 state payload is critical with matches at remarks and status", () => {
    const a = assessResult(STATE_PAYLOAD, KEYWORDS);
    expect(a.severity).toBe("critical");
    expect(a.matches.map((m) => m.path).sort()).toEqual(["remarks", "status"]);
    expect(AssessmentSchema.safeParse(a).success).toBe(true);
  });

  it("[A7] NO RECORD payload is info", () => {
    const a = assessResult({ status: "NO RECORD" }, KEYWORDS);
    expect(a).toEqual({
      severity: "info",
      matches: [{ keyword: "NO RECORD", severity: "info", path: "status" }],
    });
  });

  it("[A7] a payload with no match has null severity", () => {
    expect(assessResult({ status: "CLEAR" }, KEYWORDS)).toEqual({ severity: null, matches: [] });
  });

  it("[A7] a detail-only nested STOLEN still assesses critical, with a path-language path", () => {
    const a = assessResult(
      { detail: { notes: ["ok", "STOLEN"] }, "a.b": { c: "STOLEN" } },
      KEYWORDS,
    );
    expect(a.severity).toBe("critical");
    expect(a.matches.map((m) => m.path).sort()).toEqual(['["a.b"].c', "detail.notes[1]"]);
  });

  it("[A7] severity is the maximum by SEVERITY_RANK", () => {
    const a = assessResult({ x: "WANTED", y: "NO RECORD" }, KEYWORDS);
    expect(a.severity).toBe("warning");
    expect(SEVERITY_RANK[a.severity ?? "info"]).toBe(2);
  });

  it("[A7] except phrases suppress the match", () => {
    expect(assessResult({ s: "NOT STOLEN" }, KEYWORDS).severity).toBeNull();
  });

  it("[A7] never returns leaf text", () => {
    const a = assessResult({ remarks: "SECRET-LEAF STOLEN" }, KEYWORDS);
    expect(JSON.stringify(a)).not.toContain("SECRET-LEAF");
  });

  it("[A7] ignores non-string leaves", () => {
    expect(assessResult({ n: 1, b: true, z: null, arr: [2] }, KEYWORDS).severity).toBeNull();
  });
});
