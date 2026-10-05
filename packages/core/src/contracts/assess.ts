import { z } from "zod";
import {
  type Format,
  type KeywordStyle,
  SEVERITIES,
  type Severity,
  type SiteConfig,
} from "../config/schema";
import type { SourcePayload } from "./mock-file";

/**
 * Response mapper, assessResult and highlighter contracts (spec 4.5; FR-060, UX-010, UX-011,
 * UX-015, UX-016). Signatures only: the implementations land in M2 P1 (Core). `ResponseMapping`,
 * `MappingElement`, `Format`, `KeywordStyle` and `Severity` are the config schema's (spec 4.1).
 */

export type { Severity };

/** Higher is more severe; an assessment's severity is the highest-ranked match. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  info: 1,
  warning: 2,
  critical: 3,
};

const SeveritySchema = z.enum(SEVERITIES);

/** One keyword hit: the configured keyword, its severity and the payload path of the string leaf. Never the leaf text. */
export const AssessmentMatchSchema = z.strictObject({
  keyword: z.string().min(1),
  severity: SeveritySchema,
  path: z.string(),
});
export type AssessmentMatch = z.infer<typeof AssessmentMatchSchema>;

function maxSeverity(matches: readonly AssessmentMatch[]): Severity | null {
  let best: Severity | null = null;
  for (const m of matches) {
    if (best === null || SEVERITY_RANK[m.severity] > SEVERITY_RANK[best]) best = m.severity;
  }
  return best;
}

/** `severity` is the maximum found, null when nothing matched (spec 4.5). */
export const AssessmentSchema = z
  .strictObject({
    severity: SeveritySchema.nullable(),
    matches: z.array(AssessmentMatchSchema),
  })
  .refine((a) => a.severity === maxSeverity(a.matches), {
    message: "severity must be the maximum of the matches",
    path: ["severity"],
  });
export type Assessment = z.infer<typeof AssessmentSchema>;

/** Scans every string leaf of the raw payload, independent of mapping, highlight flags and view. */
export type AssessResult = (
  payload: SourcePayload,
  keywords: readonly KeywordStyle[],
) => Assessment;

export type MappingView = "summary" | "detail" | "both";

/** Selection context: the part's query type and effective values, the source and the persona. */
export type MapContext = {
  queryType: string;
  partValues: Readonly<Record<string, unknown>>;
  sourceId: string;
  persona?: string;
};

export type RenderElement =
  | {
      kind: "scalar";
      label: { key: string } | { text: string };
      value: string;
      view: MappingView;
      format?: Format;
      highlight: boolean;
    }
  | {
      kind: "table";
      label: { key: string };
      view: MappingView;
      highlight: boolean;
      columns: { labelKey: string; format?: Format }[];
      rows: string[][];
    };

/** An element whose path did not resolve, or a table path that yielded an empty array. Development builds only. */
export type MappingDiagnostic = { path: string; reason: string };

/** `mappingIndex` null means no candidate mapping: the generic dump. */
export type MappedResult = {
  mappingIndex: number | null;
  elements: RenderElement[];
  diagnostics: MappingDiagnostic[];
};

export type MapResponse = (
  siteConfig: SiteConfig,
  ctx: MapContext,
  payload: SourcePayload,
) => MappedResult;

export type Segment = { text: string; severity?: Severity; keyword?: string };

export type Highlight = (text: string, keywords: readonly KeywordStyle[]) => Segment[];
