---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "689eb7813bf79636689762362519b460516aeacb"
verdict: "approve"
mode: "fast"
---

# Review: fix/377-terminal-tests

Date: 10-03-26

## Scope

Branch fix/377-terminal-tests, range c5c2a24b218fab84f17016054c9a7a3d20b58cd7..689eb7813bf79636689762362519b460516aeacb (one commit, 689eb78). Test-only change to two critical-tier terminal parser files, 37 lines (fast path):

- packages/core/src/terminal/submit-check.test.ts: C-M1, a draft-only invalid plateType yields validation.notInPicklist with no position (spec 4.4).
- packages/core/src/terminal/roundtrip.a5.test.ts: C-C-M1, typed-only commands assert the exact toggle pick (NAM to PER, PROP to PRO); C-C-M2, the typed-only map is keyed by site.

## Findings summary

Critical 0, important 0, minor 0. No ledger rulings touched; no controller rulings.

## Cross-cutting checks

1. format.ts selectCommand: risk that the NAM/PROP mapping contradicts the picker. Matches: first preset-free command in config order wins.
2. Shipped site configs and the fixture loader: risk that the example-ok overlay reorders NAM ahead of PER. Not the case; property tests pass at head.
3. Ran vitest on both files at head (111 passed) and biome check (clean).

## Answers to the controller's questions

None asked.

## Remaining Minors

None.
