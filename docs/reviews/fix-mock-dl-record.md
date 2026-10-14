---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "2cbbeb660e0d0e5921544f21223b551be23996a4"
verdict: "approve"
mode: "fast"
---

# Review: fix/mock-dl-record

Date: 10-13-26.

## Scope
Branch fix/mock-dl-record, range 875f4c6888e335411fe042c2205fa1f387068c5b..2cbbeb660e0d0e5921544f21223b551be23996a4 (commits 5e8f96a, merge a43d0cd, earlier artifact 2db4a1e, 2cbbeb6). Delivers one synthetic driver's licence record in the default mock (stateSource DL, licenseNumber ZZDLTEST) and admits `licensenumber` in the fixture policy `other` kind (#602, design ruling 10). Re-review after the matcher test moved out of critical packages/core/src/mock/ into scripts/mock-data/generate.test.ts and the policy doc comment named licence keys. Gate slice: packages/core/src/config/fixture-policy.ts, 14 lines. No critical path in the diff.

## Findings summary
Critical 0, Important 0, Minor 1. No rulings contested; context rulings kept as they stand. The earlier Minor (comment at :26 omitted licence) is resolved in 2cbbeb6.

## Cross-cutting checks
None needed outside the diff: the changed file was read in full and its consumers of the key list (walk, checkLeaf) live in the same file; no new file, so no sensitive-paths gap.

## Answers
1. Yes. The policy stays an allowlist (unknown key is fixture.unknownKey, fixture-policy.ts:206-209). `licensenumber` sits only in `other` (:69). `other` rejects objects (:175) and any string or number with a run of 4 or more digits (:181-184); the year exception applies only to `year` (:176). ZZDL12345 and 12345678 are rejected, tested. No other check changed. The :26 edit is comment-only, inside the JSDoc block :22-28.

## Remaining Minors
- fixture-policy.ts:26: the edited comment line runs past 100 columns; rewrap at next touch.
