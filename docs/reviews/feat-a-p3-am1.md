---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "5eebf91a15842a6a94eb0c272cb8c0a4f87a012c"
verdict: "approve"
---

# Review: feat/a-p3-am1 (gate tier)

Date: 10-03-26

## Scope

Branch feat/a-p3-am1, range bf38ab18bbab9f392b6440c831c2d876d0519aca..5eebf91a15842a6a94eb0c272cb8c0a4f87a012c, gate tier only (no critical file changed). The wave delivers plan Task 21, the P2 PR-2 gate minors: #315 (ws upgrade limit tests and shared unknown bucket, restore-test -f check and visible cleanup errors, step-12 no-echo guard, oasdiff rename map for recursive schemas and discriminators), #303 Task 9 (config CLI unreadable-file reporting, read order, plateType warnings found by rule content), #311 gate boxes (lost-key scope assertion, smoke system actor constant, lost-data-key query trigger check), #220 r1-a (strip-comments regex literals) and #497 G-M1/G-M2 (logger sink newline escape, board-dates impossible dates and finish before start), plus controller inline fixes (Finish never precedes Start, ws comment cites spec 5.3, web testTimeout 15 s for #499).

## Findings summary

- Critical: 0. Important: 0. Minor: 3.
- Rulings kept as stands: developer 10-02-26 shared ws:ip:unknown bucket; developer 10-02-26 #303 constants stay put; sdd 21a CV1 (restore-test cleanup warning, real-Docker check at release); sdd 21d IC1 and the controller's 15 s web testTimeout (#499 stays open).
- Out of scope by design: critical boxes of #311 and #220 ride AC2 via #497.

## Cross-cutting checks

1. packages/core/src/config/migrate.ts: config-files.ts now migrates the raw site first; migrateConfig returns diagnostics for a non-object or bad version and never throws. No issue.
2. .github/sensitive-paths: the two new test files fall under scripts/ci/** and scripts/ops/** (gate). No issue.
3. .github/workflows/ci.yml step 12: the pinned export-line regex in ci-workflow.test.ts matches the real export line. No issue.

## Answers to the controller's questions

None asked.

## Remaining Minors

- M1 scripts/ci/strip-comments.ts regexAllowedAfter: postfix `++` or `--` before a division is read as a regex start, so `i++ / 2; // it(...)` keeps the comment (rare fail-open in hasTaggedTest).
- M2 scripts/ci/strip-comments.ts: a keyword before a regex (`return /a\//`) is still not recognised; the line is truncated at `//` (bounded, fails closed).
- M3 scripts/ci/smoke-request-key.test.ts: identitySource compared to the literal "system", not a SYSTEM_ACTOR field.
