---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "cd1d3db767d06f5b3917d017270708128e81e6b3"
verdict: "approve"
---

# Review: fix/b-p2-minors-329

Date: 09-29-26.

## Scope

Branch fix/b-p2-minors-329, range 743670d9559b764a9001064c1a2cb2e09c6308c6..cd1d3db767d06f5b3917d017270708128e81e6b3. Delivers the #329 minors from the fix/b-p2-core-minors review: gate slice G-M1 and G-M2 (`FIXTURE_IMPORT` guard catches directory-index and template-literal specifiers, scripts/ci), critical slice C-CR-M1 to C-CR-M4 (packages/core/src/terminal: leak check substring skip keyed on known config strings, rest-remainder suffix joins in `typedValues`, redundant optional chain removed in roundtrip.a5.test.ts, `positionedKeys` doc says interior empties).

## Findings summary

- Gate slice (Opus 5.5 medium): approve, 0 critical, 0 important.
- Critical slice (Opus 5.5 high): approve, 0 critical, 0 important, 0 minor.
- Ruling kept as stands: checker 09-29-26 (#323), exact and case-insensitive echoes fail everywhere; #329 C-CR-M1 narrows the substring skip to config field keys and labelKeys. Implemented as ruled.
- Ruling kept as stands: production core files never import from __fixtures__ (#323 G-M1).
- No controller rulings in this run.

## Cross-cutting checks

- Critical slice: packages/core/src/terminal/tokenize.ts, risk that the new `positionedKeys` doc misstates behaviour. Trailing blank tokens break before a push; doc matches.
- Critical slice: ran the two changed test files at head, doubt that the narrowed skip flags a real parser input. 101 tests passed.
- Gate slice checks are in its own report.

## Answers to the controller's questions

None asked.

## Remaining Minors

None.
