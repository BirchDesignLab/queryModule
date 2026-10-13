import type { Assessment, AssessmentMatch, AssessResult } from "../contracts/assess";
import { SEVERITY_RANK } from "../contracts/assess";
import { findHits } from "./highlight";
import { childPath } from "./path";

/**
 * assessResult (spec 4.5; FR-060): scans every string leaf of the raw payload, independent of
 * mapping, view and highlight flags. Matches carry the keyword, severity and path, never leaf text.
 */

function walk(value: unknown, path: string, visit: (text: string, path: string) => void): void {
  if (typeof value === "string") {
    visit(value, path);
  } else if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) walk(v, childPath(path, i), visit);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, childPath(path, k), visit);
  }
}

export const assessResult: AssessResult = (payload, keywords) => {
  const matches: AssessmentMatch[] = [];
  walk(payload, "", (text, path) => {
    const seen = new Set<string>();
    for (const h of findHits(text.normalize("NFC"), keywords)) {
      if (seen.has(h.keyword)) continue;
      seen.add(h.keyword);
      matches.push({ keyword: h.keyword, severity: h.severity, path });
    }
  });
  let severity: Assessment["severity"] = null;
  for (const m of matches) {
    if (severity === null || SEVERITY_RANK[m.severity] > SEVERITY_RANK[severity]) {
      severity = m.severity;
    }
  }
  return { severity, matches };
};
