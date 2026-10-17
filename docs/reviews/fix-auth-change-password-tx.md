---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "690471aa6b38e8ab4192f8258c1e054cb8355f58"
verdict: "approve"
---

# Review: fix/auth-change-password-tx

Date: 10-17-26. Gate slice, Opus 5.5 medium (re-review after minors fix).

## Scope

Branch fix/auth-change-password-tx, range 5132459360d95e32a204be4d4d87ecedcdeb7989..690471aa6b38e8ab4192f8258c1e054cb8355f58. Gate files packages/api/src/auth/auth.ts and packages/api/src/auth/routes.ts. The wave moves change-password into the app (#690, Ruling on #690 option A): verify and hash through Better Auth's $context.password, then update account.password, clear mustChangePassword and record passwordChanged in one transaction; removes the clear-must-change-password plugin. 690471a fixes the first pass's three minors.

## Findings summary

Critical 0, important 0, minor 0. First-pass minors G-m1, G-m2, G-m3 fixed in 690471a. Ruling on #690 (option A) stands as applied.

## Cross-cutting checks

- New tests pass and leave the tree clean: password-change.test.ts at head, 19/19 passed; git status clean after.

## Answers to the controller's questions

1. Yes. G-m1 auth.ts:212-213; G-m2 routes.ts:258-259; G-m3 password-change.test.ts:299 and 316-333. 690471a changes only comment lines in the two gate files, so route behavior is unchanged.
2. Yes. One transaction (routes.ts:281-297), guards and limiter unchanged (routes.ts:35-44, 248-262), refusal codes match Better Auth (routes.ts:219-226), log carries ids and error name only (routes.ts:300-304), plugin removed (auth.ts:226) with pin test passing.

## Remaining Minors

None.
