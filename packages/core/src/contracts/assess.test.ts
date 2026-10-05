import { describe, expect, expectTypeOf, it } from "vitest";
import type { KeywordStyle, SiteConfig } from "../config/schema";
import {
  type Assessment,
  AssessmentSchema,
  type AssessResult,
  type Highlight,
  type MapContext,
  type MappedResult,
  type MapResponse,
  type RenderElement,
  SEVERITY_RANK,
  type Segment,
} from "./assess";
import type { SourcePayload } from "./mock-file";

/** Spec 4.5 shapes; synthetic values only (spec 5.4). */
const stolen = { keyword: "STOLEN", severity: "critical", path: "vehicle.status" } as const;
const caution = { keyword: "CAUTION", severity: "warning", path: "notes[0]" } as const;

describe("FR-060 UX-010 UX-011 assessResult contract (spec 4.5)", () => {
  it("parses the spec 4.5 example: severity is the maximum of the matches", () => {
    const a = { severity: "critical", matches: [stolen, caution] };
    expect(AssessmentSchema.parse(a)).toEqual(a);
  });

  it("parses no matches with a null severity", () => {
    expect(AssessmentSchema.parse({ severity: null, matches: [] })).toEqual({
      severity: null,
      matches: [],
    });
  });

  it("rejects an unknown severity on the assessment and on a match", () => {
    expect(AssessmentSchema.safeParse({ severity: "caution", matches: [] }).success).toBe(false);
    expect(
      AssessmentSchema.safeParse({
        severity: "critical",
        matches: [{ ...stolen, severity: "none" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a severity that is not the maximum of the matches", () => {
    expect(AssessmentSchema.safeParse({ severity: "warning", matches: [stolen] }).success).toBe(
      false,
    );
    expect(AssessmentSchema.safeParse({ severity: null, matches: [caution] }).success).toBe(false);
    expect(AssessmentSchema.safeParse({ severity: "info", matches: [] }).success).toBe(false);
  });

  it("is strict and carries no payload values beyond the matched keyword and its path", () => {
    expect(
      AssessmentSchema.safeParse({ severity: null, matches: [], payload: { plate: "ZZ-0001" } })
        .success,
    ).toBe(false);
    expect(
      AssessmentSchema.safeParse({
        severity: "critical",
        matches: [{ ...stolen, text: "VEHICLE STOLEN 1901" }],
      }).success,
    ).toBe(false);
  });

  it("ranks severities critical over warning over info", () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.warning);
    expect(SEVERITY_RANK.warning).toBeGreaterThan(SEVERITY_RANK.info);
  });

  it("types the assessResult, mapResponse and highlight signatures", () => {
    expectTypeOf<AssessResult>().toEqualTypeOf<
      (payload: SourcePayload, keywords: readonly KeywordStyle[]) => Assessment
    >();
    expectTypeOf<MapResponse>().toEqualTypeOf<
      (siteConfig: SiteConfig, ctx: MapContext, payload: SourcePayload) => MappedResult
    >();
    expectTypeOf<Highlight>().toEqualTypeOf<
      (text: string, keywords: readonly KeywordStyle[]) => Segment[]
    >();
    expectTypeOf<MappedResult["mappingIndex"]>().toEqualTypeOf<number | null>();
    expectTypeOf<RenderElement["kind"]>().toEqualTypeOf<"scalar" | "table">();
  });
});
