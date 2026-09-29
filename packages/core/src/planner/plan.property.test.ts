import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type SiteConfig, SiteConfigSchema } from "../config/schema";
import { evaluateForm } from "../rules/evaluate-form";
import type { FormInput } from "../rules/types";
import { isPlanError, type PlanPart, planRequest } from "./plan";

const config = SiteConfigSchema.parse(
  JSON.parse(readFileSync(new URL("../../../config/sites/default.json", import.meta.url), "utf8")),
);
const now = Date.UTC(2026, 8, 28);
const options = { now };

/** PER with five sources and WNT with four defaults, so the pair cap of 8 can be crossed. */
const wide: SiteConfig = structuredClone(config);
for (const qt of wide.queryTypes) {
  const n = qt.code === "PER" ? 5 : qt.code === "WNT" ? 4 : 0;
  if (n === 0) continue;
  qt.sources = Array.from({ length: n }, (_, i) => ({
    sourceId: `${qt.code.toLowerCase()}Source${i + 1}`,
    selectedByDefault: true,
    plateOnly: false,
  }));
}

// Canonical domains, synthetic per the fixture policy (spec 5.4): ZZ-#### plates, 1901 DOBs.
const plate = fc.integer({ min: 0, max: 9999 }).map((n) => `ZZ-${String(n).padStart(4, "0")}`);
const stateCode = fc.constantFrom("TX", "OK", "NM");
const plateTypeCode = fc.constantFrom("PC", "TK", "MC");
const year = fc.integer({ min: 1901, max: 2026 }).map(String);
const vin = fc.constantFrom("ZZ000000000000001", "ZZ00000000000000A");
const name = fc.constantFrom("Testerson", "Sampleworth", "Pat", "Sam");
const dob = fc
  .record({ m: fc.integer({ min: 1, max: 12 }), d: fc.integer({ min: 1, max: 28 }) })
  .map(({ m, d }) => `1901-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

const vehInput: fc.Arbitrary<FormInput> = fc.record(
  { plate, state: stateCode, year, vin, plateType: plateTypeCode },
  { requiredKeys: [] },
);
const perInput: fc.Arbitrary<FormInput> = fc.record(
  {
    last: name,
    first: name,
    dob,
    sex: fc.constantFrom("F", "M", "X"),
    race: fc.constantFrom("A", "B", "I", "U", "W"),
  },
  { requiredKeys: [] },
);

function sourceIdsOf(c: SiteConfig, code: string): string[] {
  return c.queryTypes.find((q) => q.code === code)?.sources.map((s) => s.sourceId) ?? [];
}

const cases = fc.oneof(
  fc.record({ c: fc.constant(config), code: fc.constant("VEH"), input: vehInput }),
  fc.record({ c: fc.constant(config), code: fc.constant("PER"), input: perInput }),
  fc.record({ c: fc.constant(wide), code: fc.constant("PER"), input: perInput }),
);
const withSelection = cases.chain((k) =>
  fc.subarray(sourceIdsOf(k.c, k.code)).map((selected) => ({ ...k, selected })),
);

/** The part re-evaluated from its own canonical values: its eligible sources and visible fields. */
function reEvaluate(c: SiteConfig, part: PlanPart) {
  const s = evaluateForm(c, part.queryType, part.values, options);
  return {
    eligible: new Set(s.sources.map((x) => x.sourceId)),
    visible: new Set(s.fields.filter((f) => f.visible).map((f) => f.key)),
  };
}

describe("NFR-002 planRequest invariants over random VEH and PER submits (spec 4.6)", () => {
  it("is deterministic, ids follow alsoRun order, sources are disjoint and eligible, the cap holds", () => {
    fc.assert(
      fc.property(withSelection, ({ c, code, input, selected }) => {
        const first = planRequest(c, code, input, selected, options);
        expect(planRequest(c, code, input, selected, options)).toEqual(first);
        if (isPlanError(first)) {
          expect(first.errors.length).toBeGreaterThan(0);
          return;
        }
        const [primary, ...nested] = first.parts;
        expect(primary).toMatchObject({ partId: 0, parentPartId: null, origin: "primary" });
        const alsoRun = c.queryTypes.find((q) => q.code === code)?.alsoRun ?? [];
        for (const part of nested) {
          expect(part.parentPartId).toBe(0);
          expect(part.queryType).toBe(alsoRun[part.partId - 1]?.queryType);
        }
        let total = 0;
        for (const part of first.parts) {
          total += part.sourceIds.length;
          const dropped = new Set(part.droppedSourceIds);
          expect(part.sourceIds.some((id) => dropped.has(id))).toBe(false);
          const { eligible, visible } = reEvaluate(c, part);
          for (const id of [...part.sourceIds, ...part.droppedSourceIds])
            expect(eligible.has(id)).toBe(true);
          for (const key of Object.keys(part.values)) expect(visible.has(key)).toBe(true);
        }
        expect(total).toBeLessThanOrEqual(8);
      }),
      { numRuns: 200 },
    );
  });
  it("is plan.tooManySources exactly when the planned pairs would exceed 8", () => {
    fc.assert(
      fc.property(perInput, fc.subarray(sourceIdsOf(wide, "PER")), (input, selected) => {
        const r = planRequest(wide, "PER", input, selected, options);
        const primaryErrors = evaluateForm(wide, "PER", input, options).errors;
        if (primaryErrors.length > 0) {
          expect(r).toEqual({ errors: primaryErrors });
          return;
        }
        // WNT gets its four defaults whenever PER's last carries over (WNT requires only last).
        const pairs = selected.length + 4;
        if (pairs > 8)
          expect(r).toEqual({ errors: [{ key: "plan.tooManySources", params: { max: 8 } }] });
        else expect(isPlanError(r)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
