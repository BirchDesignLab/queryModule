---
reviewer: "opus-5.5"
effort: "high"
reviewedSha: "312e978776332bffbf1cc3d8232f90c13dbae7f0"
verdict: "approve"
mode: "fast"
---

# Review: fix/m2-debt-4-tokenize

Date: 10-18-26

## Scope

Branch fix/m2-debt-4-tokenize, range c91391a37c67dbd2dcfae1435e92cd228a920709..312e978776332bffbf1cc3d8232f90c13dbae7f0 (2 commits, 8 insertions, 6 deletions). The branch gives the tokenize linear-time wall-clock test an explicit 30 s per-test timeout (closes #560), rewraps the createDrainStop doc comment in packages/api/src/startup.ts within 100 columns, and changes "honouring" to "honoring" in one dispatcher.ts comment (#699). No executable code changes in startup.ts or dispatcher.ts (word diff confirms identical comment text); the tokenize assertion and ratio bound are unchanged. Fast path: one reviewer covering every critical file.

## Findings summary

- Critical: 0
- Important: 0
- Minor: 2 (listed below)
- No ledger rulings or controller rulings were applied in this review.

## Cross-cutting checks

1. The comment's claim that other wall-clock tests carry an explicit bound: schema-fields.test.ts and primitives.test.ts both set 2000 ms timeouts. Holds.
2. A global vitest testTimeout that the 30 s argument would lower: none is set in the root or package vitest configs, so the default 5 s applies and 30 s raises it.
3. Rewrap width and lint: rewrapped lines are within 100 columns; biome check on the three files is clean.

## Answers to the controller's questions

None asked.

## Remaining Minors

- m1 packages/core/src/terminal/tokenize.test.ts:242: describe title "FR-055 unrecognised input" keeps a British spelling in a touched file; change to "unrecognized".
- m2 packages/core/src/terminal/tokenize.test.ts:62-63: the timeout comment sits after the assertion inside the body; optionally move it above the test or point it at the timeout argument.
