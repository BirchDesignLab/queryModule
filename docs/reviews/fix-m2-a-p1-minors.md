---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "948be9f07e9f8dba77ee263c39b4a8d6d10042b7"
verdict: "approve"
mode: "fast"
---

# Review: fix/m2-a-p1-minors

Date: 10-13-26

## Scope
Branch fix/m2-a-p1-minors, range ddd0515f8e7c9e18b8d36139f28d27401b50ffb9..948be9f07e9f8dba77ee263c39b4a8d6d10042b7, one commit, tests only. Delivers three smoke step 4 tests for the remaining readDetail failure branches (#620 G-G-m1), a 30 s describe timeout on the backup.sh preflight tests (#610), and a replay 24 h edge test (ordinary tier). Gate files: scripts/ops/smoke.test.ts, scripts/ops/backup.test.ts (42 lines, fast path).

## Findings summary
Critical 0, important 0, minor 2. No ruling contested; the Windows load-flake ruling stands. No controller rulings needed.

## Cross-cutting checks
1. scripts/ops/smoke-feed.ts: the three pinned texts exist at lines 70, 77 and 85; the not-JSON branch prints a constant, never the body.
2. Diff stat: only test files changed; smoke-feed.ts, smoke.sh and backup.sh untouched, so no behaviour change.
3. Sensitive paths: no new files; scripts/ops/** stays gate tier.

## Answers to the controller's questions
1. Yes. smoke.test.ts:454, :463, :472 pin smoke-feed.ts:70, :77, :85. The ZZ-HTML body marker (smoke.test.ts:102) is asserted absent (smoke.test.ts:464).
2. Yes. backup.test.ts:59-61 sets 30 000 ms above run()'s 25 000 ms spawnSync timeout (backup.test.ts:42); one run() per case; test file only.

## Remaining Minors
- smoke.test.ts:459-466: notJson test lacks the `not.toMatch(/4 ok/)` guard its siblings carry.
- smoke.test.ts:454: reset test matches any error name; deliberate since the fetch reject name is runtime-dependent.
