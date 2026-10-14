---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "337e72100b118bb30ac95a24f600b892aeffbc35"
verdict: "approve"
mode: "fast"
---

# Review: fix/m2-gate-minors

Date: 10-14-26

## Scope

Branch fix/m2-gate-minors, range adee3a4..337e721 (one commit, Closes #638). Gate file
packages/core/src/config/fixture-policy.ts: a shared `hasDigitRun` helper treats every
non-alphanumeric character as a separator after NFKC folding, applies the run rule to `status`
as well as `other`, and rejects numbers in exponent form. Tests and docs/site-config.md updated.

## Findings summary

Critical 0, important 0, minor 1. No controller rulings or ledger rulings changed.

## Cross-cutting checks

1. Wider separator set rejecting a shipped mock value: checked packages/config/mock/default.json
   leaves and ran fixture-policy.test.ts (82 of 82 pass, including the shipped mock files test).
   No regression.
2. New file missing from .github/sensitive-paths: no new files in the range.

## Answers to the controller's questions

1. ASCII separators, Unicode dashes and spaces, and full-width, superscript, circled and math
   digits are all caught. Non-Latin decimal digits (Arabic-Indic, Devanagari) still slip past
   (minor m1). Exponent-form numbers are caught (fixture-policy.ts:153).
2. The shipped mock passes. The exponent rule fires only for magnitudes of 1e21 and above or
   below 1e-6, so no legitimate small mock number is rejected by it.

## Remaining Minors

- m1 fixture-policy.ts:154: non-Latin decimal digits are stripped as separators and never
  counted. Fix with `/[^\p{L}\p{Nd}]/gu` and `/\p{Nd}{4,}/u`, plus a test; `freeText` (line 181)
  has the same pre-existing ASCII-only gap.
