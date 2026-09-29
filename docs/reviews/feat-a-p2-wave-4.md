---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "c94d52168a7aa8db536fd524b350cfb4f9c78668"
verdict: "approve"
---

# Review: feat/a-p2-wave-4 (critical slice)

Date: 09-28-26

## Scope

Branch feat/a-p2-wave-4, range 74a75887a8ee1674698b0abecbe01cbcbccf94e8..c94d52168a7aa8db536fd524b350cfb4f9c78668. The wave delivers Task 16 (#281): the core query planner `planRequest` (spec 4.6) with plate-only narrowing, nested alsoRun parts with stable ids and audit-safe skip reasons, and the 5.2 step 2 cap of 8 dispatched (part, source) pairs. Critical files: packages/core/src/planner/index.ts, plan.ts, plan.test.ts, plan.property.test.ts. Requirement IDs: FR-012, FR-040, FR-041, FR-042, NFR-002.

## Findings summary

- Critical: 0. Important: 0. Minor: 2.
- Rulings kept as they stand: AuditValidationError derived in plan.ts via z.infer (no new contracts export); IC1 (plan.noPlateOnlySource only in plateOnly mode; empty normal-mode selection blocked by the request schema); critic:I2 (PlanPart.mode); critic:CV1 (planner dedupes selectedSourceIds, API still owns duplicates); spec:CV1 (TDD order evidenced); part queryType is the canonical code; the recorded deferred minors.
- Controller rulings: none requested.

## Cross-cutting checks

1. New sensitive area missing from the gate: `.github/sensitive-paths` line 36 lists `packages/core/src/planner/**` as critical. Covered.
2. Ineligible sources admitted through FormState.sources: evaluate-form.ts filters sources by `when` against submitted values (hidden absent). No gap.
3. Skipped-part `typeValues` reaching a plaintext audit row: the planner takes only visible `role: "type"` effective values from evaluateForm and adds no new path. No finding.

## Answers to the controller's questions

None asked.

## Remaining Minors

- M1 plan.ts:133-134,192: Plan.droppedSourceIds and parts[0].droppedSourceIds share one array object; return a copy.
- M2 plan.test.ts:175: test title says "hidden and unknown keys" but asserts only the hidden key; retitle.
