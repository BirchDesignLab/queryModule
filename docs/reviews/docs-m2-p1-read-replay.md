---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "1fe227caea824986f64dda8f04843c11267dcf1c"
verdict: "approve"
mode: "fast"
---

# Review: docs/m2-p1-read-replay

Date: 10-13-26

## Scope

Branch docs/m2-p1-read-replay, range 82c838d047dd7f3241d7d267c4c4236021f0d743..1fe227caea824986f64dda8f04843c11267dcf1c. The branch documents the M2 P1 read routes in docs/api.md (ordinary, Refs #593) and, as the #627 follow-up, makes the CI docs-only fast path treat `.claude/workflows/` and `scripts/sdd/` (Markdown included) as non-docs so `pnpm sdd:harness` runs on them, and pins the ci.yml job set in a test. Gate lines reviewed: 29 (scripts/ci/changed-paths.mjs, scripts/ci/changed-paths.test.ts, scripts/ci/ci-workflow.test.ts).

## Findings summary

Critical 0, important 0, minor 0. No rulings or controller rulings needed. Context ruling kept as stands: Windows load flakes are not findings.

## Cross-cutting checks

1. Fix effectiveness: ci.yml gates the `test` job (which runs the harness) on docs_only (line 140), so a README-only workflow PR now runs it.
2. Exclusion completeness: scripts/sdd/workflow-harness.mjs reads only files under .claude/workflows/, scripts/sdd/ and scripts/ci/sensitive-review.ts; no docs/ or root Markdown input, so no other path needs excluding.

## Answers to the controller's questions

1. Yes. changed-paths.mjs:19-20 add the two prefix exclusions; the empty-list, docs/testing/, docs/board/ and docs/Markdown clauses, isBoardOnly and the area outputs are unchanged, and areas().docs_only still delegates to isDocsOnly (:85). The new test keeps `docs/a.md + README.md` docs-only (changed-paths.test.ts:25).
2. Yes. ci.yml's jobs (changes, checks, test, web, mobile, image, board, ci, publish, sensitive-review) equal the sorted pin at ci-workflow.test.ts:45-56; ci.yml is unchanged in the range.

## Remaining Minors

None.
