---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "e0945410efc0597e09dd7adb15110461f8533100"
verdict: "approve"
mode: "fast"
---

# Review: fix/sensitive-review-late-files (#206)

Date: 09-28-26. Reviewer: Opus 5.5, effort high, fast path (30 changed lines in critical and gate files).

## Scope

Branch `fix/sensitive-review-late-files`, range `938b798eb91f911b43f8e8b3dd33ab1fda155e7c..e0945410efc0597e09dd7adb15110461f8533100` (one commit, e094541). The fix makes `sensitive-review` count a critical or gate file as late (changed after `reviewedSha`) only when the PR itself changes it (`base...head`), so merging `main` after a review no longer fails on files only `main` changed. Files: `scripts/ci/sensitive-review.ts` (critical), `scripts/ci/sensitive-review.test.ts` (gate, three new tests and one adjusted assertion), ADR-0007 and the PR template (text only).

## Findings summary

- Critical: 0. Important: 0. Minor: 2.
- No ruling ids or controller rulings in play for this range; the #206 issue design is followed exactly.

## Cross-cutting checks

1. Other callers or implementations of the late-file rule: only `runSensitiveReview` calls `evaluateSensitiveReview`, and it passes `changedFiles` from `git diff --name-only -z --no-renames base...head` and the late list from the two-dot `reviewedSha head` diff with the same flags, so paths compare equal. No second implementation.
2. Test suite at head: `scripts/ci/sensitive-review.test.ts` 72 passed, including the real-git late-file case.
3. Stale in-repo guidance that merging `main` after review forces a re-review: none found beyond the updated ADR-0007 line.

## Answers to the controller's questions

1. No bypass. After the change the late list is a subset of the touched list (`sensitive-review.ts:218` and `:261-263`), and a file outside `base...head` never needed a review at all, so excluding it cannot pass anything the missing-artifact check would fail. A PR-touched file that drops out of `base...head` after a `main` merge has head content equal to the `main` merge-base, so the PR delivers nothing for it. A conflict resolution that differs from `main`'s side stays in `base...head` and in `reviewedSha..head`, so it is late and fails (test at `sensitive-review.test.ts:236-239`); an evil merge editing an untouched sensitive file enters both lists and fails. A stale base sha over-counts, which is conservative. Criss-cross merge-base selection is a pre-existing question for the touched list as a whole, not widened here.

## Remaining Minors

- m1: the new cases are unit-level; add one real-git `inRepo` case that merges a simulated `main` after review (expect pass) and a variant that also edits the PR's own sensitive file (expect fail).
- m2: the two failing cases assert only the message; add `expect(r.ok).toBe(false)`.
