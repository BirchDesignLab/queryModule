---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "f5d84c58133a47c75f64376421a10b25d1d70553"
verdict: "approve"
---

# Review: feat/b-p3-wave-2 (critical slice)

Date: 09-29-26.

## Scope

Branch feat/b-p3-wave-2, range 78329fe6e7096b4f505c4895bbdf4c977eebf206..f5d84c58133a47c75f64376421a10b25d1d70553. Critical-tier files: packages/core/src/terminal/index.ts, parse.ts, submit-check.ts, submit-check.test.ts (commit 70b59fd). The wave delivers `checkTerminalSubmit`, which evaluates the merged per-query-type draft on terminal submit (spec 4.4 draft merge, FR-053 to FR-056, #297 items 3 and 4), with error enrichment extracted into a shared `enrichErrors` so `parseCommand` behaviour is unchanged.

## Findings summary

- Critical: 0. Important: 0. Minor: 3.
- No ledger ruling contested; T18/c (no valueForHiddenField for preset-only keys) stands and is tested. Controller reconciliations (vin in merged drafts; PER..PAT in place of VEH..TX) stand.
- No controller rulings requested.

## Cross-cutting checks

1. New file in a critical area missing from `.github/sensitive-paths`: covered by `packages/core/src/terminal/**`.
2. Merged-draft evaluation leaking hidden draft-only values into submitted values or changing mode detection: evaluateForm prunes hidden fields from `values`; null and "" evaluate identically (property test); no defect.
3. `enrichErrors` becoming public API: `@querymodule/core` exports only `./terminal` index, which does not re-export it.

## Answers to the controller's questions

None asked.

## Remaining Minors

- M1: add a test for a draft-only value failing validation (error without position, blocks submit).
- M2: spec 4.4 does not yet name `checkTerminalSubmit` as the submit-time check.
- M3: `enrichErrors` is exported from parse.ts for the sibling module only; keep it out of any future wildcard export.
