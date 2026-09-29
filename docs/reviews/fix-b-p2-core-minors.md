---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "7a4e34669e6b13057e1eacf27451392e4ceca2de"
verdict: "approve"
---

# Review: fix/b-p2-core-minors

Date: 09-29-26.

## Scope
Branch fix/b-p2-core-minors, range 5e3e3e67e2c7f7aa6375e2e030d1bc4a902c1fde..7a4e34669e6b13057e1eacf27451392e4ceca2de. Delivers the deferred B6 minors of #323: core purity guards for `__fixtures__` and an exact pin test (gate slice), and in the terminal core (critical slice) the `trip()` no-command guard in roundtrip.a5, the stale `positionedKeys` doc, a ratio-based linear-time bound for long delimiter runs, and a leak check that keeps command codes typed. #303 Tasks 5-6 core parts are ordinary tier.

## Findings summary
- Gate slice: approve, 0 critical, 0 important.
- Critical slice: 0 critical, 0 important, 4 minor.
- Checker rulings 09-29-26 kept as stands: leak check skips only the substring test for config params (field, labelKey); #295 box 1 fixtures scope; #296 ruling 2 (named token filling an empty position moves the key to namedKeys); ratio-based delimiter time bound.
- No controller rulings in this run.

## Cross-cutting checks
- labelKey or field built from typed text would slip past the substring skip: every labelKey in terminal and rules production code comes from a config def. No leak.
- types.ts `positionedKeys` doc against tokenize.ts: the key moves to namedKeys (tokenize.ts:87-88). Doc accurate.

## Answers to the controller's questions
None asked.

## Remaining Minors
1. parse.test.ts:171,193: substring skip keyed on param name, not on value being a known config string.
2. parse.test.ts:165-168: typed list omits rest remainders joined across delimiters (pre-existing).
3. roundtrip.a5.test.ts:128: redundant `selected?.code` after the guard.
4. types.ts:18-21: "empty ones included" should say interior empties; trailing empties are dropped.
