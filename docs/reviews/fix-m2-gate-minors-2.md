---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "dbea8c2d71dfee42a2abe49ddb16ecddc7a27760"
verdict: "approve"
mode: "fast"
---

# Review: fix/m2-gate-minors-2

Date: 10-14-26

## Scope

Branch fix/m2-gate-minors-2, range 4832f72..dbea8c2 (one commit, 20 gate lines). Delivers #647: the fixture policy digit-run check (`status`, `other`) and the freeText check count decimal digits of any Unicode script (`\p{Nd}`, NFKC-folded), with `\p{L}` letters as the only run breakers. Gate file: packages/core/src/config/fixture-policy.ts. Also tests and docs/site-config.md.

## Findings summary

- Critical: 0. Important: 0. Minor: 2 (below).
- Prior rulings #636 and #638 kept as stands (non-alphanumeric separates; exponent-form numbers rejected).
- No controller rulings were needed.

## Cross-cutting checks

1. Shipped mock fails the stricter rule: ran fixture-policy and generator tests (112 passed); scripts/mock-data/generate.test.ts:186 checks packages/config/mock/ clean.
2. Realistic non-ASCII forms slip the new classes: probed the exact regexes. Thai, Bengali, circled, math-bold, combining-mark-split and ZWJ-split runs are caught; see Minors for what is not.
3. No new file; fixture-policy.ts already listed as gate in .github/sensitive-paths.

## Answers to the controller's questions

1. Other Nd scripts are caught; combining marks and format characters are stripped so digits join into one run; NFKC folds circled, superscript and math-bold digits. Still slipping: digit groups split by letters of any script (as with ASCII `12A34`, by #636 design) and non-decimal numerals without NFKC folding (negative circled digits, Ethiopic, CJK numerals).
2. Yes, the shipped mock passes. The new classes are stricter for every non-ASCII decimal digit (and full-width digits in free text, newly caught). They are looser in one case: a non-Latin letter inside a digit group now breaks the run (`12ж34` was rejected, now accepted). Plate, VIN, dob, address and year rules stay ASCII allowlists and fail closed on non-ASCII digits.

## Remaining Minors

- fixture-policy.ts:156: non-Latin letters now break a digit run where the old ASCII rule stripped them. Optional: pin with a test or treat only Latin letters as breakers.
- fixture-policy.ts:156, :183: non-decimal numerals without NFKC folding (U+2776 negative circled digits, Ethiopic, CJK numerals) are not counted. Optional follow-on: use `\p{N}`.
