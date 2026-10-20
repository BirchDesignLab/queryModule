---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "eb380cd5f3902ffaadcd8159d5768dd85a120546"
verdict: "approve"
mode: "fast"
---

# Review: feat/m2-c-p3-wave-1

Date: 10-20-26.

## Scope

Branch feat/m2-c-p3-wave-1, range 2ad7c52afff1902a94b2e1cb3490145755052346..eb380cd5f3902ffaadcd8159d5768dd85a120546 (M2 P3 Lane C, CW1, Tasks 9 to 11). The wave refuses a present, foreign Origin on every REST route, Better Auth and preflights included (D-M2P3-1, #753); adds a per-user limit of 5 wrong current passwords in 15 minutes on change-password, with no audit row for a guess or the block (D-M2P3-3); and adds the M2 security map with a test that keeps it tied to running tests. Gate-tier files: packages/api/src/app.ts, packages/api/src/http/security.ts, packages/api/src/auth/rate-limit.ts, packages/api/src/auth/routes.ts. Fast path, 45 reviewed lines, one reviewer.

## Findings summary

- Critical: 0. Important: 0. Minor: 4.
- Ledger rulings kept as stands: Task 9 (webview CAD Mobile client is admitted by CORS_ORIGINS config, not code); Task 11 (replay excludes hidden cites ADR-0014 in text, Task 18 lane A).
- No controller ruling was needed in this review.

## Cross-cutting checks

1. packages/api/src/env.ts: whether the allowed set could admit an empty entry or `null`. It cannot; entries are trimmed, the set is CORS_ORIGINS or PUBLIC_ORIGIN plus dev origins only in development. Entries are not origin-validated (minor m1).
2. packages/api/src/http/errors.ts: whether the change-password Retry-After could be zero or fractional, or the error echo more than seconds. It is at least 1, rounded up, and the body carries only retryAfterSeconds.
3. docs/decisions: the Task 11 carry-forward on ADR-0014. The ADR is not on the branch; the map marks it pending and does not claim the row closed (minor m4).

## Answers to the controller's questions

1. Yes. app.ts:40-57 mounts requireKnownOrigin on /api/* before cors, the receipt mark (app.ts:60), the body cap and requireRequestedWith (app.ts:62-67) and the auth routes (app.ts:68), so a foreign preflight is refused before CORS answers it. security.ts:71-72 passes an empty Origin (falsy) and refuses `null` (not in the set).
2. No. The refusal logs requestId and class only (security.ts:73, app.ts:44); change-password logs userId and an error name only (routes.ts:254, 312-316, 321-324); error bodies are fixed text or seconds (routes.ts:220-227, errors.ts:30-34).
3. Yes. The `changePassword:<userId>` key is read only in changePassword (routes.ts:251-256), separate from sign-in's `login:acct:<email>` (routes.ts:126); a failure is recorded only after pw.verify returns false (routes.ts:286-289); the block and wrong-guess paths make no audit call, and passwordChanged is written only in the commit transaction (routes.ts:302-308).

## Remaining Minors

- m1 env.ts:83-89: CORS_ORIGINS entries are not validated like PUBLIC_ORIGIN; a trailing slash now 403s every browser request (fails closed). Validate at startup in a later gate chore.
- m2 Spec 5.6 thresholds table lacks the change-password limit row (ledger Task 10 S1).
- m3 origin.test.ts submit case asserts the 403 but not that markReceipt did not run (ledger Task 9 Q2).
- m4 docs/testing/m2-security-map.md cites ADR-0014 as pending; the wave PR must not claim the 12.7 replay row closed until Task 18 lands.
